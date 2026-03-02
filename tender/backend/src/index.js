require('dotenv').config();

const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const mammoth = require('mammoth');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const RPCClient = require('@alicloud/pop-core');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');
const Jimp = require('jimp');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { get, initDb, query, run, transaction } = require('./db');

const app = express();
const normalizeHost = (value) => String(value || '').trim().toLowerCase();
const parseHostFromUrl = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return normalizeHost(new URL(text).hostname);
  } catch {
    return '';
  }
};

const PORT = Number(process.env.PORT || 5187);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'tender').trim() || 'tender';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';
const AUDIT_SIGNING_KEY = String(process.env.AUDIT_SIGNING_KEY || 'tender-audit-signing-key-change-me').trim();
const CONFIG_SECRET_KEY = String(process.env.CONFIG_SECRET_KEY || '').trim();

const FILE_MAX_BYTES = Math.max(1024 * 100, Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 30) * 1024 * 1024);
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || '/data/tender/uploads');
const VERSION_ROOT = path.resolve(process.env.VERSION_ROOT || `${UPLOAD_ROOT}/versions`);
const DRAFT_ROOT = path.resolve(process.env.DRAFT_ROOT || `${UPLOAD_ROOT}/drafts`);
const ASSET_ROOT = path.resolve(process.env.ASSET_ROOT || `${UPLOAD_ROOT}/assets`);
const WATERMARK_ROOT = path.resolve(process.env.WATERMARK_ROOT || `${UPLOAD_ROOT}/watermarks`);
const PREVIEW_ROOT = path.resolve(process.env.PREVIEW_ROOT || `${UPLOAD_ROOT}/previews`);
const EDITABLE_ROOT = path.resolve(process.env.EDITABLE_ROOT || `${UPLOAD_ROOT}/editable`);
const LIBREOFFICE_BIN = String(process.env.LIBREOFFICE_BIN || 'soffice').trim() || 'soffice';

const DOC_EDITOR_PROVIDER = String(process.env.DOC_EDITOR_PROVIDER || 'onlyoffice').trim();
const DOC_EDITOR_FILE_BASE_URL = String(process.env.DOC_EDITOR_FILE_BASE_URL || 'http://tender-api:5187').trim().replace(/\/+$/, '');
const DOC_EDITOR_CALLBACK_BASE_URL = String(process.env.DOC_EDITOR_CALLBACK_BASE_URL || 'http://tender-api:5187').trim().replace(/\/+$/, '');
const DOC_EDITOR_PUBLIC_PATH = String(process.env.DOC_EDITOR_PUBLIC_PATH || '/doc-editor').trim();
const DOC_EDITOR_JWT_SECRET = String(process.env.DOC_EDITOR_JWT_SECRET || 'tender-onlyoffice-jwt').trim();
const DOC_EDITOR_FORCE_VIEW_ONLY = process.env.DOC_EDITOR_FORCE_VIEW_ONLY === 'true';
const EDITOR_SESSION_TTL_MINUTES = Math.max(10, Number(process.env.EDITOR_SESSION_TTL_MINUTES || 120));
const DOC_EDITOR_DOWNLOAD_MAX_BYTES = Math.max(
  FILE_MAX_BYTES,
  Number(process.env.DOC_EDITOR_DOWNLOAD_MAX_BYTES || FILE_MAX_BYTES)
);
const DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST = Array.from(
  new Set(
    [
      ...(process.env.DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST || '')
        .split(',')
        .map(normalizeHost)
        .filter(Boolean),
      parseHostFromUrl(DOC_EDITOR_PUBLIC_PATH),
      parseHostFromUrl(DOC_EDITOR_FILE_BASE_URL),
      parseHostFromUrl(DOC_EDITOR_CALLBACK_BASE_URL),
    ].filter(Boolean)
  )
);

const LIST_MAX_LIMIT = Math.max(20, Math.min(500, Number(process.env.TENDER_LIST_MAX_LIMIT || 200)));
const AUDIT_RETENTION_DAYS_DEFAULT = Math.max(30, Number(process.env.AUDIT_RETENTION_DAYS || 365));
const AUDIT_CLEANUP_INTERVAL_MS = Math.max(6 * 60 * 60 * 1000, Number(process.env.AUDIT_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000));
const OCR_ENDPOINT_DEFAULT = 'ocr.cn-beijing.aliyuncs.com';
const OCR_API_VERSION_DEFAULT = '2021-07-07';
const OCR_TIMEOUT_MS_DEFAULT = 15000;

const SECRET_MASK = '******';
const APP_NAME = 'tender';
const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);

const ALLOWED_BID_UPLOAD_EXTS = new Set(['.doc', '.docx', '.pdf']);
const ALLOWED_BID_UPLOAD_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]);

const ALLOWED_ASSET_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const ALLOWED_ASSET_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

for (const dir of [UPLOAD_ROOT, VERSION_ROOT, DRAFT_ROOT, ASSET_ROOT, WATERMARK_ROOT, PREVIEW_ROOT, EDITABLE_ROOT]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');
const defaultOrigins = ['http://localhost:8086', 'http://127.0.0.1:8086'].map(normalizeOrigin);
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
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
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '8mb' }));

const trimText = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value).trim());

const stableStringify = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

const isWeakSecret = (value, minLength = 16) => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length < minLength) return true;
  return weakSecrets.has(text.toLowerCase());
};

const validateSecurityBootstrap = () => {
  const problems = [];
  if (isWeakSecret(AUDIT_SIGNING_KEY, 32)) problems.push('AUDIT_SIGNING_KEY 过弱（生产建议至少32位随机值）');
  if (isWeakSecret(DOC_EDITOR_JWT_SECRET, 32)) problems.push('DOC_EDITOR_JWT_SECRET 过弱（生产建议至少32位随机值）');
  if (isWeakSecret(CONFIG_SECRET_KEY, 32)) problems.push('CONFIG_SECRET_KEY 过弱（生产建议至少32位随机值）');
  if (!DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST.length) {
    problems.push('DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST 未配置，无法约束回调下载来源');
  }
  if (!problems.length) return;
  const text = `[SECURITY][tender] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) throw new Error(text);
  console.warn(`${text}。当前为非严格模式，仅告警。`);
};

const appError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const toPositiveInt = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

const toBoundedLimit = (value, fallback = 20) => {
  const n = toPositiveInt(value, fallback);
  return Math.min(n, LIST_MAX_LIMIT);
};

const formatDateTime = (date) => {
  if (!(date instanceof Date)) return null;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseMaybeJson = (value, fallback = null) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
};

const normalizePositiveNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const sha256Hex = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

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
  if (!CONFIG_SECRET_KEY) throw appError('CONFIG_SECRET_KEY 未配置，无法解密敏感配置', 500);
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

const maskSecret = (value) => (trimText(value) ? SECRET_MASK : '');

const computeAuditSignature = ({ id, prevHash, userId, username, role, action, entity, entityId, beforeData, afterData, createdAt }) => {
  const payload = [
    String(id || ''),
    String(prevHash || ''),
    String(userId || 0),
    String(username || ''),
    String(role || ''),
    String(action || ''),
    String(entity || ''),
    String(entityId || 0),
    String(beforeData || ''),
    String(afterData || ''),
    String(createdAt || ''),
  ].join('|');
  return crypto.createHmac('sha256', AUDIT_SIGNING_KEY).update(payload).digest('hex');
};

const toCsv = (rows, columns) => {
  const escape = (value) => {
    const raw = value === undefined || value === null ? '' : String(value);
    const escaped = raw.replace(/"/g, '""');
    if (/[",\n]/.test(escaped)) return `"${escaped}"`;
    return escaped;
  };

  const header = columns.map((col) => escape(col.label || col.key)).join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col.key])).join(',')).join('\n');
  return `\ufeff${header}${body ? `\n${body}` : ''}`;
};

const normalizeStatus = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (['DRAFT', 'IN_REVIEW', 'FINALIZED', 'SUBMITTED', 'ARCHIVED'].includes(normalized)) return normalized;
  return 'DRAFT';
};

const statusTransitions = {
  DRAFT: new Set(['IN_REVIEW']),
  IN_REVIEW: new Set(['FINALIZED', 'DRAFT']),
  FINALIZED: new Set(['SUBMITTED', 'DRAFT']),
  SUBMITTED: new Set(['ARCHIVED', 'DRAFT']),
  ARCHIVED: new Set(['DRAFT']),
};

const normalizeBidUploadExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_BID_UPLOAD_EXTS.has(ext) ? ext : '';
};

const normalizeAssetUploadExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_ASSET_UPLOAD_EXTS.has(ext) ? ext : '';
};

const guessMimeByExt = (ext) => {
  const normalized = trimText(ext).toLowerCase();
  if (normalized === '.pdf') return 'application/pdf';
  if (normalized === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalized === '.doc') return 'application/msword';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  if (normalized === '.png') return 'image/png';
  return 'application/octet-stream';
};

const buildStoredFilename = (filename, extOverride = '') => {
  const ext = extOverride || path.extname(String(filename || '')).toLowerCase() || '';
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
};

const readFileStatSafe = async (filePath) => {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
};

const deleteFileSafe = async (filePath) => {
  const target = trimText(filePath);
  if (!target) return;
  try {
    await fs.promises.unlink(target);
  } catch {
    // ignore
  }
};

const copyToManagedPath = async (srcPath, targetRoot, targetExt = '') => {
  const filename = buildStoredFilename(path.basename(srcPath), targetExt || path.extname(srcPath));
  const targetPath = path.join(targetRoot, filename);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.copyFile(srcPath, targetPath);
  return targetPath;
};

const runLibreOfficeConvert = async (inputPath, outDir, format) => {
  await fs.promises.mkdir(outDir, { recursive: true });
  const args = ['--headless', '--convert-to', format, '--outdir', outDir, inputPath];

  await new Promise((resolve, reject) => {
    const child = spawn(LIBREOFFICE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(stderr || `LibreOffice 转换失败，退出码 ${code}`));
    });
  });

  const src = path.parse(inputPath);
  const ext = format === 'pdf' ? '.pdf' : '.docx';
  const outPath = path.join(outDir, `${src.name}${ext}`);
  try {
    await fs.promises.access(outPath, fs.constants.R_OK);
  } catch {
    throw appError(`未找到转换产物: ${outPath}`, 500);
  }
  return outPath;
};

const applyDocxTemplate = async ({ sourcePath, outputPath, payload }) => {
  const content = await fs.promises.readFile(sourcePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    delimiters: {
      start: '{{',
      end: '}}',
    },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  doc.render(payload || {});
  const out = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.promises.writeFile(outputPath, out);
};

const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const buildSimpleDocxBuffer = (paragraphs = []) => {
  const rows = Array.isArray(paragraphs) ? paragraphs : [];
  const paragraphXml = rows
    .map((line) => {
      const text = trimText(line);
      if (!text) return '<w:p/>';
      return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    })
    .join('');

  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml || '<w:p><w:r><w:t>自动生成投标文件</w:t></w:r></w:p>'}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
  );
  zip.folder('word').folder('_rels').file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const writeSimpleDocx = async ({ outputPath, paragraphs = [] }) => {
  const buffer = buildSimpleDocxBuffer(paragraphs);
  await fs.promises.writeFile(outputPath, buffer);
};

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

const resolveDocEditorDownloadUrl = (value) => {
  const text = trimText(value);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw appError('回调下载URL无效', 400);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw appError('回调下载URL协议不受支持', 400);
  if (parsed.username || parsed.password) throw appError('回调下载URL不合法', 400);
  const host = normalizeHost(parsed.hostname);
  if (DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST.includes(host)) return parsed.toString();

  const message = `[SECURITY][tender] 回调下载域名未授权: ${host || 'unknown'}`;
  if (SECURITY_STRICT_MODE) throw appError('回调下载URL不在允许列表', 403);
  console.warn(`${message}，非严格模式放行`);
  return parsed.toString();
};

const downloadDocEditorFile = async (value, timeoutMs = 20000) => {
  const url = resolveDocEditorDownloadUrl(value);
  const response = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
  if (!response.ok) throw appError(`OnlyOffice 回调下载失败: ${response.status}`, 400);

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > DOC_EDITOR_DOWNLOAD_MAX_BYTES) {
    throw appError('OnlyOffice 回调文件过大', 413);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (!buf.length) throw appError('OnlyOffice 回调文件为空', 400);
  if (buf.length > DOC_EDITOR_DOWNLOAD_MAX_BYTES) throw appError('OnlyOffice 回调文件过大', 413);
  return buf;
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
  } catch {
    throw appError('统一登录返回异常', 401);
  }

  const user = data?.user;
  const apps = Array.isArray(data?.apps) ? data.apps : [];
  if (!user || user.id === undefined || !user.username) throw appError('登录状态无效', 401);
  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) throw appError('无权限访问标书协同制作系统', 403);

  return {
    user: {
      id: Number(user.id),
      username: String(user.username || ''),
      role: String(user.role || 'viewer').toLowerCase(),
    },
    apps,
  };
};

const getClientIp = (req) => {
  return trimText(req.ip) || trimText(req.socket?.remoteAddress) || '';
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const authRequired = asyncHandler(async (req, _res, next) => {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/api/tender/editor/callback/')) return next();
  if (/^\/api\/tender\/drafts\/\d+\/download\.docx$/.test(req.path)) return next();
  const token = extractBearerToken(req.headers.authorization) || extractCookieToken(req.headers.cookie);
  if (!token) throw appError('未登录', 401);
  if (token.length < 16 || token.length > 4096) throw appError('登录凭证非法', 401);

  const auth = await introspectToken(token);
  req.user = auth.user;
  req.authApps = auth.apps;
  next();
});

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

const hasPermission = (user, permission) => {
  const role = String(user?.role || '').toLowerCase();
  const set = permissionByRole[role] || new Set();
  return set.has(permission);
};

const requirePermission = (permission) =>
  asyncHandler(async (req, _res, next) => {
    if (!hasPermission(req.user, permission)) {
      throw appError('无权限', 403);
    }
    next();
  });

app.use(authRequired);

const nextBidNo = async () => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `TB-${day}-`;
  const row = await get('SELECT COUNT(1) AS count FROM tender_bids WHERE bid_no LIKE ?', [`${prefix}%`]);
  const seq = String(Number(row?.count || 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
};

const ensureBidExists = async (bidId) => {
  const row = await get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
  if (!row) throw appError('标书不存在', 404);
  return row;
};

const getCurrentVersion = async (bid) => {
  if (!Number.isFinite(Number(bid?.current_version_id))) return null;
  return get('SELECT * FROM tender_bid_versions WHERE id = ? LIMIT 1', [Number(bid.current_version_id)]);
};

const getNextVersionNo = async (tx, bidId) => {
  const row = await tx.get('SELECT MAX(version_no) AS max_no FROM tender_bid_versions WHERE bid_id = ?', [bidId]);
  return Number(row?.max_no || 0) + 1;
};

const resolveDefaultRetentionDays = async () => {
  const row = await get('SELECT value FROM tender_system_configs WHERE `key` = ? LIMIT 1', ['audit_retention_days']);
  const parsed = Number(parseMaybeJson(row?.value, AUDIT_RETENTION_DAYS_DEFAULT));
  return Number.isFinite(parsed) && parsed >= 30 ? parsed : AUDIT_RETENTION_DAYS_DEFAULT;
};

const getSystemConfigs = async () => {
  const rows = await query('SELECT `key`, value FROM tender_system_configs');
  const configs = {};
  for (const row of rows) {
    configs[row.key] = parseMaybeJson(row.value, row.value);
  }
  if (!configs.audit_retention_days) configs.audit_retention_days = AUDIT_RETENTION_DAYS_DEFAULT;
  return configs;
};

const buildTenderConfigResponse = (configs = {}) => {
  const envAccessKeyId = trimText(process.env.OCR_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID);
  const envAccessKeySecret = trimText(process.env.OCR_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET);
  const envEndpoint = trimText(process.env.OCR_ENDPOINT || OCR_ENDPOINT_DEFAULT);
  const envApiVersion = trimText(process.env.OCR_API_VERSION || OCR_API_VERSION_DEFAULT);
  const envTimeoutMs = normalizePositiveNumber(process.env.OCR_TIMEOUT_MS, OCR_TIMEOUT_MS_DEFAULT, 3000, 120000);

  const hasDbSecret = !!trimText(configs.ocr_access_key_secret_enc);
  const hasSecret = hasDbSecret || !!envAccessKeySecret;

  return {
    audit_retention_days: normalizePositiveNumber(configs.audit_retention_days, AUDIT_RETENTION_DAYS_DEFAULT, 30, 3650),
    ocr_enabled: normalizeBoolean(configs.ocr_enabled, true),
    ocr_access_key_id: trimText(configs.ocr_access_key_id || envAccessKeyId),
    ocr_access_key_secret: hasSecret ? SECRET_MASK : '',
    ocr_endpoint: trimText(configs.ocr_endpoint || envEndpoint || OCR_ENDPOINT_DEFAULT),
    ocr_api_version: trimText(configs.ocr_api_version || envApiVersion || OCR_API_VERSION_DEFAULT),
    ocr_timeout_ms: normalizePositiveNumber(configs.ocr_timeout_ms, envTimeoutMs, 3000, 120000),
  };
};

const resolveOcrRuntimeConfig = async () => {
  const configs = await getSystemConfigs();
  const envAccessKeyId = trimText(process.env.OCR_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID);
  const envAccessKeySecret = trimText(process.env.OCR_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET);

  let dbSecret = '';
  const secretEnc = trimText(configs.ocr_access_key_secret_enc);
  if (secretEnc) {
    try {
      dbSecret = trimText(decryptValue(secretEnc));
    } catch {
      throw appError('OCR密钥解密失败，请检查CONFIG_SECRET_KEY配置', 500);
    }
  }

  return {
    enabled: normalizeBoolean(configs.ocr_enabled, true),
    accessKeyId: trimText(configs.ocr_access_key_id || envAccessKeyId),
    accessKeySecret: dbSecret || envAccessKeySecret,
    endpoint: trimText(configs.ocr_endpoint || process.env.OCR_ENDPOINT || OCR_ENDPOINT_DEFAULT),
    apiVersion: trimText(configs.ocr_api_version || process.env.OCR_API_VERSION || OCR_API_VERSION_DEFAULT),
    timeoutMs: normalizePositiveNumber(configs.ocr_timeout_ms || process.env.OCR_TIMEOUT_MS, OCR_TIMEOUT_MS_DEFAULT, 3000, 120000),
  };
};

const upsertSystemConfig = async (key, value) => {
  await run(
    'INSERT INTO tender_system_configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
    [key, JSON.stringify(value)]
  );
};

const insertOperationLog = async ({
  userId = null,
  username = null,
  userRole = null,
  action,
  entity,
  entityId = null,
  message = null,
  beforeData = null,
  afterData = null,
  requestIp = null,
}) => {
  const beforeText = stableStringify(beforeData);
  const afterText = stableStringify(afterData);
  const actorName = trimText(username) || 'system';
  const actorRole = trimText(userRole) || 'system';

  return transaction(async (tx) => {
    const prev = await tx.get('SELECT signature FROM tender_operation_logs ORDER BY id DESC LIMIT 1 FOR UPDATE');
    const prevHash = trimText(prev?.signature) || null;
    const createdAt = formatDateTime(new Date());

    const inserted = await tx.run(
      `INSERT INTO tender_operation_logs
        (user_id, username, user_role, action, entity, entity_id, message, before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'v1', ?, ?)`,
      [
        Number.isFinite(Number(userId)) ? Number(userId) : null,
        actorName,
        actorRole,
        trimText(action).slice(0, 64) || 'UNKNOWN',
        trimText(entity).slice(0, 64) || 'unknown',
        Number.isFinite(Number(entityId)) ? Number(entityId) : null,
        trimText(message).slice(0, 255) || null,
        beforeText,
        afterText,
        prevHash,
        trimText(requestIp).slice(0, 64) || null,
        createdAt,
      ]
    );

    const signature = computeAuditSignature({
      id: inserted.insertId,
      prevHash,
      userId,
      username: actorName,
      role: actorRole,
      action,
      entity,
      entityId,
      beforeData: beforeText,
      afterData: afterText,
      createdAt,
    });

    await tx.run('UPDATE tender_operation_logs SET signature = ? WHERE id = ?', [signature, inserted.insertId]);
    return inserted.insertId;
  });
};

const logOperation = async ({ req, action, entity, entityId = null, message = null, beforeData = null, afterData = null }) => {
  await insertOperationLog({
    userId: req?.user?.id,
    username: req?.user?.username,
    userRole: req?.user?.role,
    action,
    entity,
    entityId,
    message,
    beforeData,
    afterData,
    requestIp: getClientIp(req),
  });
};

const logSystemOperation = async ({ action, entity, entityId = null, message = null, beforeData = null, afterData = null }) => {
  await insertOperationLog({
    userId: 0,
    username: 'system',
    userRole: 'system',
    action,
    entity,
    entityId,
    message,
    beforeData,
    afterData,
    requestIp: '127.0.0.1',
  });
};

const ensureDraftForBid = async ({ bid, user }) => {
  let draft = await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [Number(bid.id)]);
  if (draft) return draft;

  const version = await getCurrentVersion(bid);
  if (!version) throw appError('标书尚无版本文件，请先上传版本文件', 409);

  const sourceExtRaw = trimText(version.source_ext).toLowerCase();
  const sourceExt = sourceExtRaw.startsWith('.') ? sourceExtRaw : `.${sourceExtRaw}`;
  if (!['.docx', '.doc'].includes(sourceExt)) {
    throw appError('当前版本不是可编辑的Word文档，无法创建协同草稿', 409);
  }

  let editableSource = trimText(version.storage_path);
  if (sourceExt === '.doc') {
    const convertedDocx = await runLibreOfficeConvert(version.storage_path, EDITABLE_ROOT, 'docx');
    editableSource = await copyToManagedPath(convertedDocx, EDITABLE_ROOT, '.docx');
  }

  const draftPath = await copyToManagedPath(editableSource, DRAFT_ROOT, '.docx');
  const info = await run(
    `INSERT INTO tender_bid_drafts
      (bid_id, base_version_id, draft_file_path, draft_file_name, draft_ext, updated_by_id, updated_by_name, last_saved_at)
     VALUES (?, ?, ?, ?, 'docx', ?, ?, NOW())`,
    [
      Number(bid.id),
      Number(version.id),
      draftPath,
      `${trimText(bid.title) || 'tender'}-draft.docx`,
      Number(user?.id) || null,
      trimText(user?.username) || null,
    ]
  );
  draft = await get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [Number(info.insertId)]);
  return draft;
};

const buildOnlyOfficeConfig = ({ session, bid, draft, editableUrl, callbackUrl }) => {
  const config = {
    document: {
      fileType: 'docx',
      key: `tender-${bid.id}-${draft.id}-${Number(bid.current_version_id || 0)}`,
      title: `${trimText(bid.title) || '标书'}-draft.docx`,
      url: editableUrl,
      permissions: {
        edit: !DOC_EDITOR_FORCE_VIEW_ONLY,
        download: true,
        print: true,
      },
    },
    documentType: 'word',
    editorConfig: {
      mode: DOC_EDITOR_FORCE_VIEW_ONLY ? 'view' : 'edit',
      lang: 'zh-CN',
      callbackUrl,
      user: {
        id: String(session.user_id),
        name: String(session.username),
      },
      customization: {
        autosave: true,
        forcesave: true,
      },
    },
  };

  return {
    provider: DOC_EDITOR_PROVIDER,
    serverPath: DOC_EDITOR_PUBLIC_PATH,
    config,
    token: jwt.sign(config, DOC_EDITOR_JWT_SECRET, { expiresIn: '2h' }),
  };
};

const verifyDraftAccessToken = (value) => {
  const token = trimText(value);
  if (!token) throw appError('缺少访问令牌', 401);
  try {
    return jwt.verify(token, DOC_EDITOR_JWT_SECRET);
  } catch {
    throw appError('访问令牌无效', 401);
  }
};

const bidVersionUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VERSION_ROOT),
    filename: (_req, file, cb) => {
      const ext = normalizeBidUploadExt(file.originalname || '') || '.docx';
      cb(null, buildStoredFilename(file.originalname, ext));
    },
  }),
  limits: {
    fileSize: FILE_MAX_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = normalizeBidUploadExt(file.originalname || '');
    const mime = trimText(file.mimetype).toLowerCase();
    if (!ext || (!ALLOWED_BID_UPLOAD_MIME.has(mime) && mime)) {
      return cb(appError('仅支持上传 doc/docx/pdf', 400));
    }
    return cb(null, true);
  },
});

const uploadBidVersion = (req, res, next) => {
  bidVersionUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(appError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, 400));
    }
    return next(appError(err.message || '文件上传失败', err.statusCode || 400));
  });
};

const tenderSourceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ASSET_ROOT),
    filename: (_req, file, cb) => {
      const ext = normalizeBidUploadExt(file.originalname || '') || '.docx';
      cb(null, buildStoredFilename(file.originalname, ext));
    },
  }),
  limits: {
    fileSize: FILE_MAX_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = normalizeBidUploadExt(file.originalname || '');
    const mime = trimText(file.mimetype).toLowerCase();
    if (!ext || (!ALLOWED_BID_UPLOAD_MIME.has(mime) && mime)) {
      return cb(appError('仅支持上传 doc/docx/pdf', 400));
    }
    return cb(null, true);
  },
});

const uploadTenderSourceFile = (req, res, next) => {
  tenderSourceUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(appError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, 400));
    }
    return next(appError(err.message || '文件上传失败', err.statusCode || 400));
  });
};

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FILE_MAX_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = normalizeAssetUploadExt(file.originalname || '');
    const mime = trimText(file.mimetype).toLowerCase();
    if (!ext || (!ALLOWED_ASSET_UPLOAD_MIME.has(mime) && mime)) {
      return cb(appError('仅支持上传 jpg/png/pdf', 400));
    }
    return cb(null, true);
  },
});

const uploadAssetFile = (req, res, next) => {
  assetUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(appError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, 400));
    }
    return next(appError(err.message || '文件上传失败', err.statusCode || 400));
  });
};

const extractOcrText = (data) => {
  if (!data) return '';
  let payload = data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
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

const runAliyunOcr = async ({ buffer }) => {
  const runtime = await resolveOcrRuntimeConfig();
  const accessKeyId = trimText(runtime.accessKeyId);
  const accessKeySecret = trimText(runtime.accessKeySecret);
  const endpoint = trimText(runtime.endpoint || OCR_ENDPOINT_DEFAULT);
  const apiVersion = trimText(runtime.apiVersion || OCR_API_VERSION_DEFAULT);

  if (!runtime.enabled) {
    return { text: '', error: 'OCR功能已禁用' };
  }

  if (!accessKeyId || !accessKeySecret) {
    return { text: '', error: 'OCR_ACCESS_KEY_ID/OCR_ACCESS_KEY_SECRET 未配置' };
  }

  try {
    const client = new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint,
      apiVersion,
      timeout: runtime.timeoutMs,
    });
    const res = await client.request(
      'RecognizeGeneral',
      { body: buffer },
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } }
    );
    const text = extractOcrText(res?.Data ?? res?.data ?? res);
    return { text: String(text || ''), error: null };
  } catch (err) {
    return { text: '', error: err.message || 'OCR识别失败' };
  }
};

const detectDocType = (ocrText = '', assetType = '') => {
  const source = `${trimText(assetType)} ${trimText(ocrText)}`.replace(/\s+/g, '').toLowerCase();
  if (!source) return 'OTHER';
  if (source.includes('身份证') || source.includes('居民身份证') || source.includes('id_card') || source.includes('idcard')) return 'ID_CARD';
  if (source.includes('营业执照') || source.includes('business_license') || source.includes('businesslicense')) return 'BUSINESS_LICENSE';
  if (source.includes('毕业证') || source.includes('学位证') || source.includes('education_cert')) return 'EDUCATION_CERT';
  if (source.includes('合同') || source.includes('协议') || source.includes('contract')) return 'CONTRACT';
  if (source.includes('资质') || source.includes('证书') || source.includes('许可证') || source.includes('qualification')) return 'QUALIFICATION';
  return 'OTHER';
};

const normalizeOcrDate = (raw) => {
  const text = trimText(raw);
  if (!text) return '';
  if (text.includes('长期')) return '长期';
  const match = text.match(/((?:19|20)\d{2})[年.\-/]((?:0?[1-9])|(?:1[0-2]))[月.\-/]((?:0?[1-9])|(?:[12]\d)|(?:3[01]))/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const normalizeIdCardNo = (raw) => trimText(raw).replace(/[^0-9xX]/g, '').toUpperCase();

const parseBirthFromIdNo = (idNo) => {
  const clean = normalizeIdCardNo(idNo);
  if (!/^[1-9]\d{16}[0-9X]$/.test(clean)) return '';
  const yyyy = clean.slice(6, 10);
  const mm = clean.slice(10, 12);
  const dd = clean.slice(12, 14);
  return `${yyyy}-${mm}-${dd}`;
};

const parseGenderFromIdNo = (idNo) => {
  const clean = normalizeIdCardNo(idNo);
  if (!/^[1-9]\d{16}[0-9X]$/.test(clean)) return '';
  return Number(clean[16]) % 2 === 0 ? '女' : '男';
};

const calcAgeByBirthDate = (birthDate) => {
  const value = trimText(birthDate);
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const now = new Date();
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) {
    age -= 1;
  }
  if (!Number.isFinite(age) || age < 0 || age > 120) return null;
  return age;
};

const extractIdCardFields = (ocrText = '') => {
  const text = trimText(ocrText);
  const compact = text.replace(/\s+/g, '');
  const nameMatch = compact.match(/姓名[:：]?([\u4e00-\u9fa5·]{2,12})(?=性别|民族|出生|住址|公民身份号码|号码|$)/);
  const genderMatch = compact.match(/性别[:：]?(男|女)/);
  const birthMatch = compact.match(/出生[:：]?((?:19|20)\d{2}[年.\-/](?:0?[1-9]|1[0-2])[月.\-/](?:0?[1-9]|[12]\d|3[01])日?)/);
  const idNoMatch = compact.match(/([1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx])/);
  const validityMatch = compact.match(
    /(?:有效期限?|有效期)[:：]?((?:19|20)\d{2}[年.\-/](?:0?[1-9]|1[0-2])[月.\-/](?:0?[1-9]|[12]\d|3[01])日?)[至\-~—]+((?:长期)|(?:19|20)\d{2}[年.\-/](?:0?[1-9]|1[0-2])[月.\-/](?:0?[1-9]|[12]\d|3[01])日?)/
  );
  const addressMatch = compact.match(/(?:住址|地址)[:：]?(.{6,60}?)(?=公民身份号码|签发机关|有效期限?|$)/);

  const idNo = normalizeIdCardNo(idNoMatch ? idNoMatch[1] : '');
  const birthDate = normalizeOcrDate(birthMatch ? birthMatch[1] : '') || parseBirthFromIdNo(idNo);
  const validFrom = normalizeOcrDate(validityMatch ? validityMatch[1] : '');
  const validToRaw = normalizeOcrDate(validityMatch ? validityMatch[2] : '');
  const validLongTerm = validToRaw === '长期';
  const validTo = validLongTerm ? '' : validToRaw;
  const gender = trimText(genderMatch ? genderMatch[1] : '') || parseGenderFromIdNo(idNo);
  const name = trimText(nameMatch ? nameMatch[1] : '');

  return {
    name,
    id_no: idNo,
    gender,
    birth_date: birthDate,
    address: trimText(addressMatch ? addressMatch[1] : ''),
    valid_from: validFrom,
    valid_to: validTo,
    valid_long_term: validLongTerm ? 1 : 0,
    age: calcAgeByBirthDate(birthDate),
  };
};

const extractBusinessLicenseFields = (ocrText = '') => {
  const text = trimText(ocrText);
  const compact = text.replace(/\s+/g, '');
  const pick = (regex) => {
    const match = compact.match(regex);
    return trimText(match ? match[1] : '');
  };

  const companyName = pick(/(?:名称|企业名称|单位名称)[:：]?([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,80}?)(?=统一社会信用代码|社会信用代码|类型|法定代表人|注册资本|成立日期|住所|经营范围|营业期限|$)/);
  const uscc = pick(/(?:统一社会信用代码|社会信用代码|信用代码)[:：]?([0-9A-Z]{18})/i).toUpperCase();
  const companyNature = pick(/(?:类型|企业类型)[:：]?([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,40}?)(?=法定代表人|注册资本|成立日期|住所|经营范围|营业期限|$)/);
  const legalRepresentative = pick(/(?:法定代表人|法人代表|法定负责人)[:：]?([\u4e00-\u9fa5·]{2,20})/);
  const registeredCapital = pick(/(?:注册资本|注册资金)[:：]?([^\n\r]{2,40}?)(?=成立日期|住所|经营范围|营业期限|$)/);
  const establishedDateRaw = pick(/(?:成立日期|注册日期)[:：]?((?:19|20)\d{2}[年.\-/](?:0?[1-9]|1[0-2])[月.\-/](?:0?[1-9]|[12]\d|3[01])日?)/);
  const address = pick(/(?:住所|营业场所|地址)[:：]?(.{6,120}?)(?=经营范围|营业期限|登记机关|核准日期|$)/);
  const businessScope = pick(/(?:经营范围)[:：]?(.{8,300}?)(?=营业期限|登记机关|核准日期|发照日期|$)/);
  const termMatch = compact.match(
    /(?:营业期限|经营期限)[:：]?((?:长期)|(?:19|20)\d{2}[年.\-/](?:0?[1-9]|1[0-2])[月.\-/](?:0?[1-9]|[12]\d|3[01])日?)\s*(?:至|-|~|—|到)\s*((?:长期)|(?:19|20)\d{2}[年.\-/](?:0?[1-9]|1[0-2])[月.\-/](?:0?[1-9]|[12]\d|3[01])日?)/
  );

  const validFrom = normalizeOcrDate(termMatch ? termMatch[1] : '');
  const validToRaw = normalizeOcrDate(termMatch ? termMatch[2] : '');
  const validLongTerm = validToRaw === '长期';
  const validTo = validLongTerm ? '' : validToRaw;
  const establishedDate = normalizeOcrDate(establishedDateRaw);
  const businessTerm = termMatch
    ? `${validFrom || ''}${validToRaw ? ` 至 ${validToRaw}` : ''}`.trim()
    : '';

  return {
    company_name: companyName,
    uscc,
    company_nature: companyNature,
    legal_representative: legalRepresentative,
    registered_capital: registeredCapital,
    established_date: establishedDate,
    company_address: address,
    business_scope: businessScope,
    valid_from: validFrom,
    valid_to: validTo,
    valid_long_term: validLongTerm ? 1 : 0,
    business_term: businessTerm,
  };
};

const extractStructuredFields = (ocrText = '', assetType = '') => {
  const text = trimText(ocrText);
  const docType = detectDocType(text, assetType);
  const idCardFields = docType === 'ID_CARD' ? extractIdCardFields(text) : null;
  const bizLicenseFields = docType === 'BUSINESS_LICENSE' ? extractBusinessLicenseFields(text) : null;

  const certNoMatch = text.match(/(?:证书编号|证书号|编号|合同编号|号码)[:：\s]*([A-Za-z0-9\-_/]{4,64})/i);
  const issuerMatch = text.match(/(?:发证机关|颁发机关|签发机关|甲方|签发单位)[:：\s]*([^\n\r]{2,80})/i);
  const subjectMatch = text.match(/(?:姓名|单位名称|企业名称|乙方|持证人)[:：\s]*([^\n\r]{2,80})/i);

  const datePairMatch = text.match(
    /(20\d{2}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?)\s*(?:至|-|~|—|到)\s*(20\d{2}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?)/i
  );

  const fields = {
    doc_type: docType,
    title: docType === 'ID_CARD' ? '居民身份证' : docType === 'BUSINESS_LICENSE' ? '营业执照' : docType,
    certificate_no: idCardFields?.id_no || bizLicenseFields?.uscc || (certNoMatch ? certNoMatch[1] : ''),
    subject: idCardFields?.name || bizLicenseFields?.company_name || (subjectMatch ? subjectMatch[1] : ''),
    issuer: idCardFields?.issuer || (issuerMatch ? issuerMatch[1] : ''),
    valid_from: idCardFields?.valid_from || bizLicenseFields?.valid_from || (datePairMatch ? datePairMatch[1] : ''),
    valid_to: idCardFields?.valid_to || bizLicenseFields?.valid_to || (datePairMatch ? datePairMatch[2] : ''),
    valid_long_term: idCardFields?.valid_long_term || bizLicenseFields?.valid_long_term || 0,
    name: idCardFields?.name || '',
    id_no: idCardFields?.id_no || '',
    gender: idCardFields?.gender || '',
    birth_date: idCardFields?.birth_date || '',
    age: Number.isFinite(idCardFields?.age) ? idCardFields.age : null,
    address: idCardFields?.address || '',
    company_name: bizLicenseFields?.company_name || '',
    uscc: bizLicenseFields?.uscc || '',
    company_nature: bizLicenseFields?.company_nature || '',
    legal_representative: bizLicenseFields?.legal_representative || '',
    registered_capital: bizLicenseFields?.registered_capital || '',
    established_date: bizLicenseFields?.established_date || '',
    company_address: bizLicenseFields?.company_address || '',
    business_scope: bizLicenseFields?.business_scope || '',
    business_term: bizLicenseFields?.business_term || '',
    summary: text ? text.slice(0, 500) : '',
  };

  let confidence = 0.45;
  if (fields.certificate_no) confidence += 0.2;
  if (fields.subject) confidence += 0.1;
  if (fields.issuer) confidence += 0.1;
  if (fields.valid_to) confidence += 0.15;
  if (docType === 'ID_CARD') {
    if (fields.name) confidence += 0.1;
    if (fields.id_no) confidence += 0.2;
    if (fields.birth_date) confidence += 0.1;
  }
  if (docType === 'BUSINESS_LICENSE') {
    if (fields.company_name) confidence += 0.15;
    if (fields.uscc) confidence += 0.2;
    if (fields.legal_representative) confidence += 0.1;
    if (fields.registered_capital) confidence += 0.1;
    if (fields.company_address) confidence += 0.1;
  }

  return {
    fields,
    confidence: Math.min(0.95, Math.max(0.1, confidence)),
  };
};

const renderWatermarkImage = async ({ sourcePath, targetPath, watermarkText }) => {
  const image = await Jimp.read(sourcePath);
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const layer = new Jimp(image.bitmap.width, image.bitmap.height, 0x00000000);

  const stepX = Math.max(180, Math.floor(image.bitmap.width / 3));
  const stepY = Math.max(120, Math.floor(image.bitmap.height / 4));

  for (let y = 20; y < image.bitmap.height; y += stepY) {
    for (let x = 20; x < image.bitmap.width; x += stepX) {
      layer.print(font, x, y, watermarkText, stepX);
    }
  }

  layer.opacity(0.15);
  image.composite(layer, 0, 0, {
    mode: Jimp.BLEND_SOURCE_OVER,
    opacitySource: 0.2,
  });

  await image.quality(90).writeAsync(targetPath);
};

const renderWatermarkPdf = async ({ sourcePath, targetPath, watermarkText }) => {
  const bytes = await fs.promises.readFile(sourcePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const stepX = Math.max(220, Math.floor(width / 2));
    const stepY = Math.max(180, Math.floor(height / 3));
    for (let y = 50; y < height; y += stepY) {
      for (let x = 30; x < width; x += stepX) {
        page.drawText(watermarkText, {
          x,
          y,
          size: 14,
          font,
          rotate: degrees(-25),
          color: rgb(0.3, 0.3, 0.3),
          opacity: 0.2,
        });
      }
    }
  }

  const out = await pdfDoc.save();
  await fs.promises.writeFile(targetPath, out);
};

const createWatermarkText = ({ req, purpose }) => {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const username = trimText(req?.user?.username) || 'unknown';
  const ip = trimText(getClientIp(req)) || 'unknown';
  return `${username} | ${ts} | ${ip} | ${purpose}`;
};

const renderWatermarkedFile = async ({ req, asset, purpose = 'preview' }) => {
  const sourcePath = trimText(asset.storage_path);
  const stat = await readFileStatSafe(sourcePath);
  if (!stat?.isFile()) throw appError('文件不存在', 404);

  const ext = path.extname(sourcePath).toLowerCase();
  const watermarkText = createWatermarkText({ req, purpose });
  const targetPath = path.join(WATERMARK_ROOT, buildStoredFilename(asset.original_file_name, ext));

  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
    await renderWatermarkImage({ sourcePath, targetPath, watermarkText });
  } else if (ext === '.pdf') {
    await renderWatermarkPdf({ sourcePath, targetPath, watermarkText });
  } else {
    await fs.promises.copyFile(sourcePath, targetPath);
  }

  return {
    path: targetPath,
    mime: guessMimeByExt(ext),
    filename: asset.original_file_name || path.basename(targetPath),
  };
};

const resolveModelRuntime = (modelRow) => {
  const modelKey = trimText(modelRow?.model_key);
  const localModelName = trimText(modelRow?.model_name);
  const localBaseUrl = trimText(modelRow?.base_url);
  const localApiKey = trimText(modelRow?.api_key_enc) ? trimText(decryptValue(modelRow.api_key_enc)) : '';

  const fallbackBaseUrl = trimText(process.env.AI_OPENAI_BASE_URL || '');
  const fallbackApiKey = trimText(process.env.AI_OPENAI_API_KEY || '');

  const base_url = localBaseUrl || fallbackBaseUrl;
  const api_key = localApiKey || fallbackApiKey;
  const model_name =
    localModelName ||
    trimText(
      modelKey === 'aliyun_qwen_3_5'
        ? process.env.AI_QWEN_MODEL_NAME
        : modelKey === 'aliyun_kimi_2_5'
          ? process.env.AI_KIMI_MODEL_NAME
          : modelKey === 'aliyun_claude'
            ? process.env.AI_CLAUDE_MODEL_NAME
            : ''
    ) ||
    localModelName;

  if (!base_url || !api_key || !model_name) {
    throw appError('模型配置不完整（base_url/api_key/model_name）', 400);
  }

  return {
    base_url,
    api_key,
    model_name,
    timeout_ms: Math.max(3000, Number(modelRow?.timeout_ms || 20000)),
    max_tokens: Math.max(256, Number(modelRow?.max_tokens || 4096)),
    temperature_default: Number(modelRow?.temperature_default || 0.3),
    extra_headers: parseMaybeJson(modelRow?.extra_headers_json, {}),
  };
};

const callOpenAiCompatible = async ({ runtime, messages, temperature, maxTokens }) => {
  const endpoint = `${runtime.base_url.replace(/\/+$/, '')}/chat/completions`;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runtime.api_key}`,
  };

  const extraHeaders = runtime.extra_headers && typeof runtime.extra_headers === 'object' ? runtime.extra_headers : {};
  for (const [key, val] of Object.entries(extraHeaders)) {
    if (!key || val === undefined || val === null) continue;
    headers[key] = String(val);
  }

  const body = {
    model: runtime.model_name,
    messages,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : runtime.temperature_default,
    max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : runtime.max_tokens,
  };

  const startedAt = Date.now();
  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    runtime.timeout_ms
  );
  const raw = await resp.text();
  const latencyMs = Date.now() - startedAt;

  if (!resp.ok) {
    throw appError(`模型调用失败: HTTP ${resp.status} ${raw.slice(0, 200)}`, 400);
  }

  const parsed = parseMaybeJson(raw, null);
  if (!parsed) throw appError('模型返回非JSON', 400);
  const content = parsed?.choices?.[0]?.message?.content;
  if (!trimText(content)) throw appError('模型返回内容为空', 400);

  return {
    content: String(content),
    usage: parsed?.usage || {},
    latencyMs,
    raw,
  };
};

const getPromptTemplate = async (taskType) => {
  const row = await get('SELECT * FROM tender_ai_prompts WHERE task_type = ? AND is_active = 1 LIMIT 1', [taskType]);
  if (!row) throw appError(`缺少任务提示词: ${taskType}`, 400);
  return trimText(row.prompt_template);
};

const resolveModel = async (modelId) => {
  let row;
  if (Number.isFinite(Number(modelId)) && Number(modelId) > 0) {
    row = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [Number(modelId)]);
  } else {
    row = await get('SELECT * FROM tender_ai_models WHERE is_default = 1 LIMIT 1');
    if (!row) row = await get('SELECT * FROM tender_ai_models WHERE is_enabled = 1 ORDER BY id ASC LIMIT 1');
  }
  if (!row) throw appError('未找到可用模型', 400);
  if (Number(row.is_enabled || 0) !== 1) throw appError('模型已禁用', 400);
  return row;
};

const extractJsonCandidate = (text) => {
  const trimmed = trimText(text);
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = trimmed.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // ignore
    }
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = trimmed.slice(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // ignore
    }
  }

  return null;
};

const runAiTask = async ({ req, taskType, inputText, modelId, extraSystemPrompt = '' }) => {
  if (!trimText(inputText)) throw appError('输入文本不能为空', 400);

  const model = await resolveModel(modelId);
  const runtime = resolveModelRuntime(model);
  const prompt = await getPromptTemplate(taskType);

  const systemPrompt = extraSystemPrompt ? `${prompt}\n${extraSystemPrompt}` : prompt;

  const requestPayload = {
    taskType,
    modelId: Number(model.id),
    inputText,
  };

  const requestHash = sha256Hex(stableStringify(requestPayload));

  let taskLogId = null;
  try {
    const result = await callOpenAiCompatible({
      runtime,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inputText },
      ],
      temperature: runtime.temperature_default,
      maxTokens: runtime.max_tokens,
    });

    const responseHash = sha256Hex(result.raw || result.content);

    const insert = await run(
      `INSERT INTO tender_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, request_hash, response_hash, error_message, operator_id, operator_name, request_ip)
       VALUES (?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        taskType,
        Number(model.id),
        trimText(model.name),
        Number(result.latencyMs || 0),
        Number(result.usage?.prompt_tokens || 0),
        Number(result.usage?.completion_tokens || 0),
        Number(result.usage?.total_tokens || 0),
        requestHash,
        responseHash,
        Number(req.user.id),
        trimText(req.user.username),
        trimText(getClientIp(req)),
      ]
    );
    taskLogId = insert.insertId;

    await logOperation({
      req,
      action: 'AI_TASK_RUN',
      entity: 'ai_task',
      entityId: taskLogId,
      message: `执行AI任务 ${taskType}`,
      afterData: {
        task_type: taskType,
        model_id: model.id,
        model_name: model.name,
        latency_ms: result.latencyMs,
      },
    });

    return {
      task_log_id: taskLogId,
      model: {
        id: model.id,
        name: model.name,
      },
      content: result.content,
      parsed: extractJsonCandidate(result.content),
      usage: {
        prompt_tokens: Number(result.usage?.prompt_tokens || 0),
        completion_tokens: Number(result.usage?.completion_tokens || 0),
        total_tokens: Number(result.usage?.total_tokens || 0),
      },
      latency_ms: result.latencyMs,
    };
  } catch (err) {
    const insert = await run(
      `INSERT INTO tender_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, request_hash, response_hash, error_message, operator_id, operator_name, request_ip)
       VALUES (?, ?, ?, 'FAILED', ?, ?, NULL, ?, ?, ?, ?)`,
      [
        taskType,
        Number(model.id),
        trimText(model.name),
        0,
        requestHash,
        trimText(err.message).slice(0, 2000),
        Number(req.user.id),
        trimText(req.user.username),
        trimText(getClientIp(req)),
      ]
    );
    taskLogId = insert.insertId;

    await logOperation({
      req,
      action: 'AI_TASK_FAIL',
      entity: 'ai_task',
      entityId: taskLogId,
      message: `AI任务失败 ${taskType}`,
      afterData: {
        task_type: taskType,
        model_id: model.id,
        model_name: model.name,
        error: err.message,
      },
    });
    throw err;
  }
};

const verifyAuditChain = async (limitInput) => {
  const limit = Math.min(Math.max(Number(limitInput || 10000), 1), 50000);
  const rows = await query(
    `SELECT id, user_id, username, user_role, action, entity, entity_id, before_data, after_data, prev_hash, signature, created_at
     FROM tender_operation_logs
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
      role: row.user_role,
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

const performAuditCleanup = async () => {
  const retentionDays = await resolveDefaultRetentionDays();
  const before = await get(
    `SELECT
       (SELECT COUNT(1) FROM tender_operation_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS op_count,
       (SELECT COUNT(1) FROM tender_ai_task_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS ai_count`,
    [retentionDays, retentionDays]
  );

  const opCount = Number(before?.op_count || 0);
  const aiCount = Number(before?.ai_count || 0);

  await run('DELETE FROM tender_operation_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [retentionDays]);
  await run('DELETE FROM tender_ai_task_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [retentionDays]);

  await logSystemOperation({
    action: 'AUDIT_CLEANUP',
    entity: 'audit',
    message: '执行审计留存清理任务',
    beforeData: {
      retention_days: retentionDays,
      op_to_delete: opCount,
      ai_to_delete: aiCount,
    },
    afterData: {
      retention_days: retentionDays,
      op_deleted: opCount,
      ai_deleted: aiCount,
    },
  });
};

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: APP_NAME });
});

app.get('/api/tender/bootstrap', asyncHandler(async (req, res) => {
  const bidCount = await get('SELECT COUNT(1) AS count FROM tender_bids');
  const activeDrafts = await get('SELECT COUNT(1) AS count FROM tender_bid_drafts');
  const assetCount = await get('SELECT COUNT(1) AS count FROM tender_assets');
  const modelCount = await get('SELECT COUNT(1) AS count FROM tender_ai_models WHERE is_enabled = 1');

  res.json({
    user: req.user,
    permissions: {
      can_read: hasPermission(req.user, 'tender:read'),
      can_write: hasPermission(req.user, 'tender:write'),
      can_template_manage: hasPermission(req.user, 'tender:template:manage'),
      can_config_manage: hasPermission(req.user, 'tender:config:manage'),
      can_audit_read: hasPermission(req.user, 'tender:audit:read'),
      can_ai_use: hasPermission(req.user, 'tender:ai:use'),
      can_ai_manage: hasPermission(req.user, 'tender:ai:manage'),
    },
    stats: {
      bids: Number(bidCount?.count || 0),
      drafts: Number(activeDrafts?.count || 0),
      assets: Number(assetCount?.count || 0),
      enabled_models: Number(modelCount?.count || 0),
    },
  });
}));

app.get('/api/tender/bids', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 20);
  const offset = (page - 1) * limit;

  const keyword = trimText(req.query.keyword);
  const status = normalizeStatus(req.query.status || '');
  const where = [];
  const params = [];

  if (keyword) {
    where.push('(title LIKE ? OR customer_name LIKE ? OR project_name LIKE ? OR bid_no LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (trimText(req.query.status)) {
    where.push('status = ?');
    params.push(status);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await get(`SELECT COUNT(1) AS total FROM tender_bids ${whereSql}`, params);
  const rows = await query(
    `SELECT * FROM tender_bids ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: rows,
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.post('/api/tender/bids/auto-generate', requirePermission('tender:write'), uploadTenderSourceFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.path) throw appError('请上传招标文件', 400);

  const bundleId = Number(req.body?.bundle_id);
  if (!Number.isFinite(bundleId) || bundleId <= 0) throw appError('bundle_id无效', 400);

  const sourceExt = normalizeBidUploadExt(file.originalname || '') || path.extname(file.path).toLowerCase() || '.docx';
  const sourceFileName = trimText(file.originalname) || path.basename(file.path);
  const inferredByFilename = trimText(path.parse(sourceFileName).name).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').slice(0, 120);

  let inferredByDoc = '';
  if (sourceExt === '.docx') {
    try {
      const extracted = await mammoth.extractRawText({ path: file.path });
      inferredByDoc = trimText(String(extracted?.value || '').split(/\r?\n/).find((line) => trimText(line)));
    } catch {
      inferredByDoc = '';
    }
  }

  const clipText = (value, maxLen) => trimText(value).slice(0, maxLen);
  const inferredTitleSeed = clipText(trimText(inferredByDoc) || trimText(inferredByFilename) || `招标项目-${Date.now()}`, 120);
  const title = clipText(trimText(req.body?.title) || `${inferredTitleSeed}投标文件`, 200);
  const customerName = clipText(req.body?.customer_name, 120) || '待完善客户';
  const projectName = clipText(req.body?.project_name, 120) || inferredTitleSeed;
  const summaryInput = trimText(req.body?.summary);
  const summary = summaryInput || `由招标文件自动生成，来源文件：${sourceFileName}`;

  const { bundle, filledFieldValues, snippetValues } = await resolveBundlePayloadData({
    bundleId,
    requireActive: true,
  });

  const bidNo = await nextBidNo();
  const generatedDocPath = path.join(VERSION_ROOT, buildStoredFilename(`${title}-auto.docx`, '.docx'));
  const generatedDocName = `${title}-自动生成.docx`;
  const nowText = formatDateTime(new Date()) || new Date().toISOString().slice(0, 19).replace('T', ' ');

  const paragraphs = [
    '投标文件（自动生成）',
    `标书编号：${bidNo}`,
    `标书标题：${title}`,
    `客户名称：${customerName}`,
    `项目名称：${projectName}`,
    `模板包：${bundle.name}（${bundle.bundle_code}）`,
    `招标文件：${sourceFileName}`,
    `生成时间：${nowText}`,
    '',
    '一、模板字段',
  ];

  if (filledFieldValues.length) {
    for (const [idx, field] of filledFieldValues.entries()) {
      const label = trimText(field.field_name) || trimText(field.field_code) || `字段${idx + 1}`;
      paragraphs.push(`${idx + 1}. ${label}：${trimText(field.field_value) || '-'}`);
    }
  } else {
    paragraphs.push('无字段条目');
  }

  paragraphs.push('', '二、模板片段');
  if (snippetValues.length) {
    for (const [idx, snippet] of snippetValues.entries()) {
      paragraphs.push(`【片段${idx + 1}】${trimText(snippet.title) || trimText(snippet.snippet_code) || snippet.bind_key}`);
      paragraphs.push(trimText(snippet.content) || '-');
      paragraphs.push('');
    }
  } else {
    paragraphs.push('无片段条目');
  }

  await writeSimpleDocx({ outputPath: generatedDocPath, paragraphs });
  const generatedStat = await readFileStatSafe(generatedDocPath);
  if (!generatedStat?.isFile()) {
    await deleteFileSafe(generatedDocPath);
    throw appError('自动生成投标文件失败', 500);
  }

  let created;
  try {
    created = await transaction(async (tx) => {
      const bidInfo = await tx.run(
        `INSERT INTO tender_bids
          (bid_no, title, customer_name, project_name, status, summary, created_by_id, created_by_name, updated_by_id, updated_by_name)
         VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
        [
          bidNo,
          title,
          customerName,
          projectName,
          summary || null,
          Number(req.user.id),
          req.user.username,
          Number(req.user.id),
          req.user.username,
        ]
      );
      const bidId = Number(bidInfo.insertId);

      const versionInfo = await tx.run(
        `INSERT INTO tender_bid_versions
          (bid_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type, created_by_id, created_by_name)
         VALUES (?, 1, 'auto_generate', 'docx', ?, ?, ?, ?, ?, ?)`,
        [
          bidId,
          generatedDocPath,
          generatedDocName,
          Number(generatedStat.size || 0),
          guessMimeByExt('.docx'),
          Number(req.user.id),
          req.user.username,
        ]
      );
      const versionId = Number(versionInfo.insertId);

      await tx.run(
        `UPDATE tender_bids
         SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [versionId, Number(req.user.id), req.user.username, bidId]
      );

      for (const pair of filledFieldValues) {
        await tx.run(
          `INSERT INTO tender_bid_field_values
            (bid_id, field_code, field_value, source, updated_by_id, updated_by_name)
           VALUES (?, ?, ?, 'template_fill', ?, ?)`,
          [bidId, pair.field_code, pair.field_value, Number(req.user.id), req.user.username]
        );
      }

      const assetInfo = await tx.run(
        `INSERT INTO tender_assets
          (bid_id, asset_type, original_file_name, mime_type, storage_path, file_size, status, uploaded_by_id, uploaded_by_name)
         VALUES (?, 'BIDDING_NOTICE', ?, ?, ?, ?, 'UPLOADED', ?, ?)`,
        [
          bidId,
          sourceFileName,
          trimText(file.mimetype) || guessMimeByExt(sourceExt),
          file.path,
          Number(file.size || 0),
          Number(req.user.id),
          req.user.username,
        ]
      );

      return {
        bidId,
        versionId,
        assetId: Number(assetInfo.insertId),
      };
    });
  } catch (err) {
    await deleteFileSafe(generatedDocPath);
    await deleteFileSafe(file.path);
    throw err;
  }

  const bid = await ensureBidExists(created.bidId);
  const version = await get('SELECT * FROM tender_bid_versions WHERE id = ? LIMIT 1', [created.versionId]);
  const sourceAsset = await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [created.assetId]);
  const draft = await ensureDraftForBid({ bid, user: req.user });

  await logOperation({
    req,
    action: 'BID_AUTO_GENERATE',
    entity: 'bid',
    entityId: created.bidId,
    message: `上传招标文件自动生成投标文件 ${bid.bid_no}`,
    afterData: {
      bid_id: created.bidId,
      bid_no: bid.bid_no,
      bundle_id: bundle.id,
      bundle_code: bundle.bundle_code,
      source_file: sourceFileName,
      field_count: filledFieldValues.length,
      snippet_count: snippetValues.length,
    },
  });

  await logOperation({
    req,
    action: 'ASSET_UPLOAD',
    entity: 'asset',
    entityId: created.assetId,
    message: `上传招标文件 ${sourceFileName}`,
    afterData: {
      bid_id: created.bidId,
      asset_type: 'BIDDING_NOTICE',
      file_name: sourceFileName,
    },
  });

  res.status(201).json({
    ok: true,
    bid,
    version,
    draft,
    source_asset: sourceAsset,
    bundle: { id: bundle.id, code: bundle.bundle_code, name: bundle.name },
    applied: {
      fields: filledFieldValues,
      snippets: snippetValues.map((item) => item.bind_key),
    },
  });
}));

app.get('/api/tender/bids/:id', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(id);
  const currentVersion = await getCurrentVersion(bid);
  const draft = await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [id]);
  res.json({ ...bid, currentVersion, draft });
}));

app.post('/api/tender/bids', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const title = trimText(req.body?.title);
  const customer_name = trimText(req.body?.customer_name);
  const project_name = trimText(req.body?.project_name);
  const summary = trimText(req.body?.summary);

  if (!title) throw appError('标书标题不能为空', 400);
  if (!customer_name) throw appError('客户名称不能为空', 400);
  if (!project_name) throw appError('项目名称不能为空', 400);

  const bidNo = await nextBidNo();
  const info = await run(
    `INSERT INTO tender_bids
      (bid_no, title, customer_name, project_name, status, summary, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
    [bidNo, title, customer_name, project_name, summary || null, Number(req.user.id), req.user.username, Number(req.user.id), req.user.username]
  );

  const row = await get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [info.insertId]);

  await logOperation({
    req,
    action: 'BID_CREATE',
    entity: 'bid',
    entityId: row.id,
    message: `创建标书 ${row.bid_no}`,
    afterData: row,
  });

  res.status(201).json(row);
}));

app.put('/api/tender/bids/:id', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('标书ID无效', 400);

  const before = await ensureBidExists(id);
  const title = trimText(req.body?.title) || before.title;
  const customer_name = trimText(req.body?.customer_name) || before.customer_name;
  const project_name = trimText(req.body?.project_name) || before.project_name;
  const summary = req.body?.summary === undefined ? before.summary : trimText(req.body?.summary);

  await run(
    `UPDATE tender_bids
     SET title = ?, customer_name = ?, project_name = ?, summary = ?,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [title, customer_name, project_name, summary || null, Number(req.user.id), req.user.username, id]
  );

  const row = await ensureBidExists(id);
  await logOperation({
    req,
    action: 'BID_UPDATE',
    entity: 'bid',
    entityId: id,
    message: `更新标书 ${row.bid_no}`,
    beforeData: before,
    afterData: row,
  });

  res.json(row);
}));

app.post('/api/tender/bids/:id/status', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = normalizeStatus(req.body?.status);
  if (!Number.isFinite(id) || id <= 0) throw appError('标书ID无效', 400);

  const before = await ensureBidExists(id);
  const fromStatus = normalizeStatus(before.status);

  if (fromStatus !== nextStatus) {
    const allowed = statusTransitions[fromStatus] || new Set();
    if (!allowed.has(nextStatus)) {
      throw appError(`状态不允许从 ${fromStatus} 变更为 ${nextStatus}`, 400);
    }
  }

  const submittedFields = nextStatus === 'SUBMITTED'
    ? ', submitted_at = NOW(), submitted_by_id = ?, submitted_by_name = ?'
    : '';
  const archivedFields = nextStatus === 'ARCHIVED'
    ? ', archived_at = NOW(), archived_by_id = ?, archived_by_name = ?'
    : '';

  const params = [nextStatus, Number(req.user.id), req.user.username];
  if (nextStatus === 'SUBMITTED') {
    params.push(Number(req.user.id), req.user.username);
  }
  if (nextStatus === 'ARCHIVED') {
    params.push(Number(req.user.id), req.user.username);
  }
  params.push(id);

  await run(
    `UPDATE tender_bids
     SET status = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     ${submittedFields}
     ${archivedFields}
     WHERE id = ?`,
    params
  );

  const after = await ensureBidExists(id);
  await logOperation({
    req,
    action: 'BID_STATUS',
    entity: 'bid',
    entityId: id,
    message: `标书状态变更 ${fromStatus} -> ${nextStatus}`,
    beforeData: { status: fromStatus },
    afterData: { status: nextStatus },
  });

  res.json(after);
}));

app.post('/api/tender/bids/:id/versions/upload', requirePermission('tender:write'), uploadBidVersion, asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId);

  const file = req.file;
  if (!file?.path) throw appError('请上传文件', 400);

  const sourceExt = normalizeBidUploadExt(file.originalname || '') || path.extname(file.path).toLowerCase();
  const sourceType = 'upload';

  let storedPath = file.path;
  let fileName = file.originalname || path.basename(file.path);
  let fileSize = Number(file.size || 0);
  let mime = trimText(file.mimetype) || guessMimeByExt(sourceExt);

  if (sourceExt === '.doc') {
    const converted = await runLibreOfficeConvert(file.path, EDITABLE_ROOT, 'docx');
    const managed = await copyToManagedPath(converted, VERSION_ROOT, '.docx');
    storedPath = managed;
    fileName = `${path.parse(fileName).name}.docx`;
    fileSize = Number((await readFileStatSafe(managed))?.size || fileSize);
    mime = guessMimeByExt('.docx');
  }

  const result = await transaction(async (tx) => {
    const nextVersionNo = await getNextVersionNo(tx, bidId);
    const insert = await tx.run(
      `INSERT INTO tender_bid_versions
        (bid_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type, created_by_id, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bidId,
        nextVersionNo,
        sourceType,
        sourceExt === '.doc' ? '.docx' : sourceExt,
        storedPath,
        fileName,
        fileSize,
        mime,
        Number(req.user.id),
        req.user.username,
      ]
    );

    await tx.run(
      `UPDATE tender_bids
       SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [insert.insertId, Number(req.user.id), req.user.username, bidId]
    );

    return tx.get('SELECT * FROM tender_bid_versions WHERE id = ?', [insert.insertId]);
  });

  await run('DELETE FROM tender_bid_drafts WHERE bid_id = ?', [bidId]);
  await ensureDraftForBid({ bid: await ensureBidExists(bidId), user: req.user });

  await logOperation({
    req,
    action: 'VERSION_UPLOAD',
    entity: 'bid_version',
    entityId: Number(result.id),
    message: `上传标书版本 v${result.version_no}`,
    afterData: result,
  });

  res.status(201).json(result);
}));

app.get('/api/tender/bids/:id/versions', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId);
  const rows = await query(
    `SELECT *
     FROM tender_bid_versions
     WHERE bid_id = ?
     ORDER BY version_no DESC`,
    [bidId]
  );
  res.json(rows);
}));

app.post('/api/tender/bids/:id/versions/snapshot', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId);
  const draft = await ensureDraftForBid({ bid, user: req.user });

  const stat = await readFileStatSafe(draft.draft_file_path);
  if (!stat?.isFile()) throw appError('草稿文件不存在', 404);

  const copiedPath = await copyToManagedPath(draft.draft_file_path, VERSION_ROOT, '.docx');
  const result = await transaction(async (tx) => {
    const nextVersionNo = await getNextVersionNo(tx, bidId);
    const insert = await tx.run(
      `INSERT INTO tender_bid_versions
        (bid_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type, created_by_id, created_by_name)
       VALUES (?, ?, 'snapshot', 'docx', ?, ?, ?, ?, ?, ?)`,
      [
        bidId,
        nextVersionNo,
        copiedPath,
        `${trimText(bid.title) || 'tender'}-v${nextVersionNo}.docx`,
        Number(stat.size || 0),
        guessMimeByExt('.docx'),
        Number(req.user.id),
        req.user.username,
      ]
    );

    await tx.run(
      `UPDATE tender_bids
       SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [insert.insertId, Number(req.user.id), req.user.username, bidId]
    );

    await tx.run(
      `UPDATE tender_bid_drafts
       SET base_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [insert.insertId, Number(req.user.id), req.user.username, Number(draft.id)]
    );

    return tx.get('SELECT * FROM tender_bid_versions WHERE id = ?', [insert.insertId]);
  });

  await logOperation({
    req,
    action: 'VERSION_SNAPSHOT',
    entity: 'bid_version',
    entityId: Number(result.id),
    message: `创建快照版本 v${result.version_no}`,
    afterData: result,
  });

  res.status(201).json(result);
}));

app.post('/api/tender/bids/:id/editor/session', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);

  const bid = await ensureBidExists(bidId);
  const draft = await ensureDraftForBid({ bid, user: req.user });

  const callbackToken = crypto.randomBytes(24).toString('hex');
  const sessionKey = crypto.randomUUID().replace(/-/g, '');

  const info = await run(
    `INSERT INTO tender_editor_sessions
      (session_key, bid_id, version_id, draft_id, user_id, username, status, callback_token, opened_at, last_heartbeat)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())`,
    [
      sessionKey,
      Number(bidId),
      Number(bid.current_version_id || 0) || null,
      Number(draft.id),
      Number(req.user.id),
      req.user.username,
      callbackToken,
    ]
  );

  const session = await get('SELECT * FROM tender_editor_sessions WHERE id = ?', [info.insertId]);

  const draftToken = jwt.sign(
    {
      type: 'tender_draft',
      sessionKey,
      draftId: Number(draft.id),
    },
    DOC_EDITOR_JWT_SECRET,
    { expiresIn: `${EDITOR_SESSION_TTL_MINUTES}m` }
  );

  const editableUrl = `${DOC_EDITOR_FILE_BASE_URL}/api/tender/drafts/${draft.id}/download.docx?token=${encodeURIComponent(draftToken)}`;
  const callbackUrl = `${DOC_EDITOR_CALLBACK_BASE_URL}/api/tender/editor/callback/${sessionKey}?token=${encodeURIComponent(callbackToken)}`;

  const editor = buildOnlyOfficeConfig({ session, bid, draft, editableUrl, callbackUrl });

  await logOperation({
    req,
    action: 'EDITOR_SESSION_CREATE',
    entity: 'editor_session',
    entityId: Number(session.id),
    message: '创建在线协同编辑会话',
    afterData: {
      bid_id: bidId,
      session_key: sessionKey,
      draft_id: draft.id,
    },
  });

  res.json({
    provider: DOC_EDITOR_PROVIDER,
    session,
    draft,
    editor,
  });
}));

app.post('/api/tender/bids/:id/editor/release', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId);

  await run(
    `UPDATE tender_editor_sessions
     SET status = 'released', closed_at = NOW(), updated_at = NOW()
     WHERE bid_id = ? AND user_id = ? AND status = 'active'`,
    [bidId, Number(req.user.id)]
  );

  await logOperation({
    req,
    action: 'EDITOR_SESSION_RELEASE',
    entity: 'editor_session',
    entityId: bidId,
    message: '释放当前用户的协同编辑会话',
  });

  res.json({ ok: true });
}));

app.get('/api/tender/drafts/:id/download.docx', asyncHandler(async (req, res) => {
  const draftId = Number(req.params.id);
  if (!Number.isFinite(draftId) || draftId <= 0) throw appError('草稿ID无效', 400);

  const payload = verifyDraftAccessToken(req.query.token || req.params.accessToken);
  const sessionKey = trimText(payload?.sessionKey);
  const tokenDraftId = Number(payload?.draftId);
  if (!sessionKey || tokenDraftId !== draftId) throw appError('访问令牌无效', 401);

  const session = await get('SELECT * FROM tender_editor_sessions WHERE session_key = ? LIMIT 1', [sessionKey]);
  if (!session) throw appError('编辑会话不存在', 404);
  if (Number(session.draft_id) !== draftId) throw appError('会话与草稿不匹配', 403);

  const draft = await get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [draftId]);
  if (!draft) throw appError('草稿不存在', 404);

  const stat = await readFileStatSafe(draft.draft_file_path);
  if (!stat?.isFile()) throw appError('草稿文件不存在', 404);

  await run('UPDATE tender_editor_sessions SET last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?', [Number(session.id)]);

  res.setHeader('Content-Type', guessMimeByExt('.docx'));
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(draft.draft_file_name || `tender-draft-${draft.id}.docx`)}`);
  res.sendFile(path.resolve(draft.draft_file_path));
}));

app.post('/api/tender/editor/callback/:sessionKey', asyncHandler(async (req, res) => {
  const sessionKey = trimText(req.params.sessionKey);
  const callbackToken = trimText(req.query.token);
  if (!sessionKey) return res.status(400).json({ error: 1 });

  const session = await get('SELECT * FROM tender_editor_sessions WHERE session_key = ? LIMIT 1', [sessionKey]);
  if (!session) return res.status(200).json({ error: 0 });
  if (!callbackToken || callbackToken !== trimText(session.callback_token)) return res.status(403).json({ error: 1 });

  const body = req.body || {};
  const status = Number(body.status || 0);
  const downloadUrl = trimText(body.url);

  if ([2, 6].includes(status) && downloadUrl) {
    const draft = await get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [Number(session.draft_id)]);
    if (draft) {
      const fileBuf = await downloadDocEditorFile(downloadUrl, 20000);
      await fs.promises.writeFile(draft.draft_file_path, fileBuf);
      await run(
        `UPDATE tender_bid_drafts
         SET last_saved_at = NOW(), updated_at = NOW(), updated_by_id = ?, updated_by_name = ?
         WHERE id = ?`,
        [Number(session.user_id), session.username, Number(draft.id)]
      );
    }
  }

  await run('UPDATE tender_editor_sessions SET last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?', [Number(session.id)]);

  return res.json({ error: 0 });
}));

app.get('/api/tender/templates/fields', requirePermission('tender:read'), asyncHandler(async (_req, res) => {
  const rows = await query('SELECT * FROM tender_template_fields ORDER BY id DESC');
  res.json(rows);
}));

app.post('/api/tender/templates/fields', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const field_code = trimText(req.body?.field_code).toUpperCase();
  const field_name = trimText(req.body?.field_name);
  if (!field_code) throw appError('field_code不能为空', 400);
  if (!field_name) throw appError('field_name不能为空', 400);

  const data_type = trimText(req.body?.data_type || 'text').toLowerCase();
  const required_flag = req.body?.required_flag ? 1 : 0;

  const info = await run(
    `INSERT INTO tender_template_fields
      (field_code, field_name, data_type, default_value, required_flag, is_active, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [
      field_code,
      field_name,
      data_type,
      req.body?.default_value || null,
      required_flag,
      Number(req.user.id),
      req.user.username,
      Number(req.user.id),
      req.user.username,
    ]
  );

  const row = await get('SELECT * FROM tender_template_fields WHERE id = ? LIMIT 1', [info.insertId]);

  await logOperation({
    req,
    action: 'TEMPLATE_FIELD_CREATE',
    entity: 'template_field',
    entityId: row.id,
    message: `新增模板字段 ${field_code}`,
    afterData: row,
  });

  res.status(201).json(row);
}));

app.put('/api/tender/templates/fields/:id', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('字段ID无效', 400);
  const before = await get('SELECT * FROM tender_template_fields WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('字段不存在', 404);

  const field_name = trimText(req.body?.field_name) || before.field_name;
  const data_type = trimText(req.body?.data_type || before.data_type).toLowerCase();
  const default_value = req.body?.default_value === undefined ? before.default_value : req.body?.default_value;
  const required_flag = req.body?.required_flag === undefined ? Number(before.required_flag || 0) : req.body?.required_flag ? 1 : 0;
  const is_active = req.body?.is_active === undefined ? Number(before.is_active || 0) : req.body?.is_active ? 1 : 0;

  await run(
    `UPDATE tender_template_fields
     SET field_name = ?, data_type = ?, default_value = ?, required_flag = ?, is_active = ?,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [field_name, data_type, default_value, required_flag, is_active, Number(req.user.id), req.user.username, id]
  );

  const row = await get('SELECT * FROM tender_template_fields WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_FIELD_UPDATE',
    entity: 'template_field',
    entityId: id,
    message: `更新模板字段 ${before.field_code}`,
    beforeData: before,
    afterData: row,
  });

  res.json(row);
}));

app.delete('/api/tender/templates/fields/:id', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('字段ID无效', 400);
  const before = await get('SELECT * FROM tender_template_fields WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('字段不存在', 404);

  await run('UPDATE tender_template_fields SET is_active = 0, updated_at = NOW() WHERE id = ?', [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_FIELD_DELETE',
    entity: 'template_field',
    entityId: id,
    message: `停用模板字段 ${before.field_code}`,
    beforeData: before,
    afterData: { is_active: 0 },
  });

  res.json({ ok: true });
}));

app.get('/api/tender/templates/snippets', requirePermission('tender:read'), asyncHandler(async (_req, res) => {
  const rows = await query('SELECT * FROM tender_template_snippets ORDER BY id DESC');
  res.json(rows.map((item) => ({ ...item, tags_json: parseMaybeJson(item.tags_json, []) })));
}));

app.post('/api/tender/templates/snippets', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const snippet_code = trimText(req.body?.snippet_code).toUpperCase();
  const title = trimText(req.body?.title);
  const content = trimText(req.body?.content);
  if (!snippet_code) throw appError('snippet_code不能为空', 400);
  if (!title) throw appError('title不能为空', 400);
  if (!content) throw appError('content不能为空', 400);

  const info = await run(
    `INSERT INTO tender_template_snippets
      (snippet_code, title, category, tags_json, content, version_no, is_active, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    [
      snippet_code,
      title,
      trimText(req.body?.category) || null,
      JSON.stringify(Array.isArray(req.body?.tags_json) ? req.body.tags_json : parseMaybeJson(req.body?.tags_json, [])),
      content,
      Number(req.user.id),
      req.user.username,
      Number(req.user.id),
      req.user.username,
    ]
  );

  const row = await get('SELECT * FROM tender_template_snippets WHERE id = ? LIMIT 1', [info.insertId]);

  await logOperation({
    req,
    action: 'TEMPLATE_SNIPPET_CREATE',
    entity: 'template_snippet',
    entityId: row.id,
    message: `新增模板片段 ${snippet_code}`,
    afterData: row,
  });

  res.status(201).json({ ...row, tags_json: parseMaybeJson(row.tags_json, []) });
}));

app.put('/api/tender/templates/snippets/:id', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('片段ID无效', 400);
  const before = await get('SELECT * FROM tender_template_snippets WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('片段不存在', 404);

  const title = trimText(req.body?.title) || before.title;
  const category = req.body?.category === undefined ? before.category : trimText(req.body?.category);
  const content = trimText(req.body?.content) || before.content;
  const tags_json = req.body?.tags_json === undefined
    ? before.tags_json
    : JSON.stringify(Array.isArray(req.body?.tags_json) ? req.body.tags_json : parseMaybeJson(req.body?.tags_json, []));
  const is_active = req.body?.is_active === undefined ? Number(before.is_active || 0) : req.body?.is_active ? 1 : 0;

  await run(
    `UPDATE tender_template_snippets
     SET title = ?, category = ?, content = ?, tags_json = ?, is_active = ?, version_no = version_no + 1,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [title, category || null, content, tags_json, is_active, Number(req.user.id), req.user.username, id]
  );

  const row = await get('SELECT * FROM tender_template_snippets WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_SNIPPET_UPDATE',
    entity: 'template_snippet',
    entityId: id,
    message: `更新模板片段 ${before.snippet_code}`,
    beforeData: before,
    afterData: row,
  });

  res.json({ ...row, tags_json: parseMaybeJson(row.tags_json, []) });
}));

app.delete('/api/tender/templates/snippets/:id', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('片段ID无效', 400);
  const before = await get('SELECT * FROM tender_template_snippets WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('片段不存在', 404);

  await run('UPDATE tender_template_snippets SET is_active = 0, updated_at = NOW() WHERE id = ?', [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_SNIPPET_DELETE',
    entity: 'template_snippet',
    entityId: id,
    message: `停用模板片段 ${before.snippet_code}`,
    beforeData: before,
    afterData: { is_active: 0 },
  });

  res.json({ ok: true });
}));

const loadBundleItems = async (bundleId) => {
  const rows = await query(
    `SELECT *
     FROM tender_template_bundle_items
     WHERE bundle_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [bundleId]
  );
  return rows;
};

const loadBundleDetail = async (bundleId) => {
  const bundle = await get('SELECT * FROM tender_template_bundles WHERE id = ? LIMIT 1', [bundleId]);
  if (!bundle) return null;
  const items = await loadBundleItems(bundleId);
  return {
    ...bundle,
    items,
  };
};

const resolveBundlePayloadData = async ({
  bundleId,
  fieldValueInput = {},
  snippetOverrideInput = {},
  requireActive = false,
}) => {
  const bundle = await loadBundleDetail(bundleId);
  if (!bundle) throw appError('模板包不存在', 404);
  if (requireActive && String(bundle.status || '').toUpperCase() !== 'ACTIVE') {
    throw appError('模板包已停用', 400);
  }

  const fieldIds = bundle.items.filter((item) => item.item_type === 'FIELD').map((item) => Number(item.ref_id));
  const snippetIds = bundle.items.filter((item) => item.item_type === 'SNIPPET').map((item) => Number(item.ref_id));

  const fieldRows = fieldIds.length
    ? await query(
      `SELECT * FROM tender_template_fields WHERE id IN (${fieldIds.map(() => '?').join(',')})`,
      fieldIds
    )
    : [];
  const snippetRows = snippetIds.length
    ? await query(
      `SELECT * FROM tender_template_snippets WHERE id IN (${snippetIds.map(() => '?').join(',')})`,
      snippetIds
    )
    : [];

  const fieldById = new Map(fieldRows.map((item) => [Number(item.id), item]));
  const snippetById = new Map(snippetRows.map((item) => [Number(item.id), item]));

  const payload = { FIELD: {}, SNIPPET: {} };
  const filledFieldValues = [];
  const snippetValues = [];

  for (const item of bundle.items) {
    if (item.item_type !== 'FIELD') continue;
    const fieldRow = fieldById.get(Number(item.ref_id));
    if (!fieldRow) continue;
    const bindKey = trimText(item.bind_key) || fieldRow.field_code;
    const incomingValue = fieldValueInput[bindKey] ?? fieldValueInput[fieldRow.field_code];
    const resolvedValue = incomingValue !== undefined && incomingValue !== null && String(incomingValue).trim() !== ''
      ? String(incomingValue)
      : trimText(fieldRow.default_value);

    payload.FIELD[bindKey] = resolvedValue || '';
    filledFieldValues.push({
      field_id: Number(fieldRow.id),
      field_code: fieldRow.field_code,
      field_name: fieldRow.field_name,
      bind_key: bindKey,
      field_value: resolvedValue || '',
    });
  }

  for (const item of bundle.items) {
    if (item.item_type !== 'SNIPPET') continue;
    const snippetRow = snippetById.get(Number(item.ref_id));
    if (!snippetRow) continue;
    const bindKey = trimText(item.bind_key) || snippetRow.snippet_code;
    const override = snippetOverrideInput[bindKey] ?? snippetOverrideInput[snippetRow.snippet_code];
    const content = trimText(override) || trimText(snippetRow.content);

    payload.SNIPPET[bindKey] = content;
    snippetValues.push({
      snippet_id: Number(snippetRow.id),
      snippet_code: snippetRow.snippet_code,
      title: snippetRow.title,
      bind_key: bindKey,
      content,
    });
  }

  return {
    bundle,
    payload,
    filledFieldValues,
    snippetValues,
  };
};

app.get('/api/tender/templates/bundles', requirePermission('tender:read'), asyncHandler(async (_req, res) => {
  const bundles = await query('SELECT * FROM tender_template_bundles ORDER BY id DESC');
  const detail = await Promise.all(
    bundles.map(async (item) => ({
      ...item,
      items: await loadBundleItems(Number(item.id)),
    }))
  );
  res.json(detail);
}));

app.post('/api/tender/templates/bundles', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const bundle_code = trimText(req.body?.bundle_code).toUpperCase();
  const name = trimText(req.body?.name);
  if (!bundle_code) throw appError('bundle_code不能为空', 400);
  if (!name) throw appError('name不能为空', 400);

  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  const bundleId = await transaction(async (tx) => {
    const info = await tx.run(
      `INSERT INTO tender_template_bundles
        (bundle_code, name, bid_type, description, version_no, status, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?, ?, ?, ?)`,
      [
        bundle_code,
        name,
        trimText(req.body?.bid_type) || null,
        trimText(req.body?.description) || null,
        Number(req.user.id),
        req.user.username,
        Number(req.user.id),
        req.user.username,
      ]
    );

    for (const rawItem of items) {
      const itemType = trimText(rawItem?.item_type).toUpperCase();
      const refId = Number(rawItem?.ref_id);
      if (!['FIELD', 'SNIPPET'].includes(itemType)) continue;
      if (!Number.isFinite(refId) || refId <= 0) continue;
      await tx.run(
        `INSERT INTO tender_template_bundle_items (bundle_id, item_type, ref_id, bind_key, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          Number(info.insertId),
          itemType,
          refId,
          trimText(rawItem?.bind_key) || null,
          Number.isFinite(Number(rawItem?.sort_order)) ? Number(rawItem.sort_order) : 0,
        ]
      );
    }

    return Number(info.insertId);
  });

  const detail = await loadBundleDetail(bundleId);

  await logOperation({
    req,
    action: 'TEMPLATE_BUNDLE_CREATE',
    entity: 'template_bundle',
    entityId: bundleId,
    message: `创建模板包 ${bundle_code}`,
    afterData: detail,
  });

  res.status(201).json(detail);
}));

app.put('/api/tender/templates/bundles/:id', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模板包ID无效', 400);
  const before = await loadBundleDetail(id);
  if (!before) throw appError('模板包不存在', 404);

  const name = trimText(req.body?.name) || before.name;
  const bid_type = req.body?.bid_type === undefined ? before.bid_type : trimText(req.body?.bid_type);
  const description = req.body?.description === undefined ? before.description : trimText(req.body?.description);
  const status = trimText(req.body?.status || before.status).toUpperCase() || 'ACTIVE';
  const items = Array.isArray(req.body?.items) ? req.body.items : before.items;

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE tender_template_bundles
       SET name = ?, bid_type = ?, description = ?, status = ?, version_no = version_no + 1,
           updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [name, bid_type || null, description || null, status, Number(req.user.id), req.user.username, id]
    );

    await tx.run('DELETE FROM tender_template_bundle_items WHERE bundle_id = ?', [id]);

    for (const rawItem of items) {
      const itemType = trimText(rawItem?.item_type).toUpperCase();
      const refId = Number(rawItem?.ref_id);
      if (!['FIELD', 'SNIPPET'].includes(itemType)) continue;
      if (!Number.isFinite(refId) || refId <= 0) continue;
      await tx.run(
        `INSERT INTO tender_template_bundle_items (bundle_id, item_type, ref_id, bind_key, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          itemType,
          refId,
          trimText(rawItem?.bind_key) || null,
          Number.isFinite(Number(rawItem?.sort_order)) ? Number(rawItem.sort_order) : 0,
        ]
      );
    }
  });

  const after = await loadBundleDetail(id);

  await logOperation({
    req,
    action: 'TEMPLATE_BUNDLE_UPDATE',
    entity: 'template_bundle',
    entityId: id,
    message: `更新模板包 ${before.bundle_code}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

app.delete('/api/tender/templates/bundles/:id', requirePermission('tender:template:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模板包ID无效', 400);
  const before = await loadBundleDetail(id);
  if (!before) throw appError('模板包不存在', 404);

  await run(`UPDATE tender_template_bundles SET status = 'INACTIVE', updated_at = NOW() WHERE id = ?`, [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_BUNDLE_DELETE',
    entity: 'template_bundle',
    entityId: id,
    message: `停用模板包 ${before.bundle_code}`,
    beforeData: before,
    afterData: { status: 'INACTIVE' },
  });

  res.json({ ok: true });
}));

app.post('/api/tender/bids/:id/fill', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const bundleId = Number(req.body?.bundle_id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(bundleId) || bundleId <= 0) throw appError('bundle_id无效', 400);

  const bid = await ensureBidExists(bidId);
  const draft = await ensureDraftForBid({ bid, user: req.user });

  const fieldValueInput = req.body?.field_values && typeof req.body.field_values === 'object' ? req.body.field_values : {};
  const snippetOverrideInput = req.body?.snippet_overrides && typeof req.body.snippet_overrides === 'object' ? req.body.snippet_overrides : {};
  const { bundle, payload, filledFieldValues, snippetValues } = await resolveBundlePayloadData({
    bundleId,
    fieldValueInput,
    snippetOverrideInput,
    requireActive: false,
  });

  const originalDraftPath = trimText(draft.draft_file_path);
  const newDraftPath = await copyToManagedPath(originalDraftPath, DRAFT_ROOT, '.docx');

  try {
    await applyDocxTemplate({ sourcePath: originalDraftPath, outputPath: newDraftPath, payload });
  } catch (err) {
    await deleteFileSafe(newDraftPath);
    throw appError(`模板填充失败: ${err.message}`, 400);
  }

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE tender_bid_drafts
       SET draft_file_path = ?, draft_file_name = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW(), last_saved_at = NOW()
       WHERE id = ?`,
      [
        newDraftPath,
        `${trimText(bid.title) || 'tender'}-filled-${Date.now()}.docx`,
        Number(req.user.id),
        req.user.username,
        Number(draft.id),
      ]
    );

    for (const pair of filledFieldValues) {
      await tx.run(
        `INSERT INTO tender_bid_field_values
          (bid_id, field_code, field_value, source, updated_by_id, updated_by_name)
         VALUES (?, ?, ?, 'template_fill', ?, ?)
         ON DUPLICATE KEY UPDATE
          field_value = VALUES(field_value),
          source = 'template_fill',
          updated_by_id = VALUES(updated_by_id),
          updated_by_name = VALUES(updated_by_name),
          updated_at = NOW()`,
        [bidId, pair.field_code, pair.field_value, Number(req.user.id), req.user.username]
      );
    }
  });

  await logOperation({
    req,
    action: 'TEMPLATE_FILL',
    entity: 'bid',
    entityId: bidId,
    message: `应用模板包 ${bundle.bundle_code}`,
    afterData: {
      bundle_id: bundle.id,
      bundle_code: bundle.bundle_code,
      field_count: filledFieldValues.length,
      snippet_count: snippetValues.length,
    },
  });

  res.json({
    ok: true,
    bundle: { id: bundle.id, code: bundle.bundle_code, name: bundle.name },
    applied: {
      fields: filledFieldValues,
      snippets: snippetValues.map((item) => item.bind_key),
    },
  });
}));

app.post('/api/tender/assets/upload', requirePermission('tender:write'), uploadAssetFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw appError('请选择上传文件', 400);

  const bidId = Number(req.body?.bid_id);
  if (Number.isFinite(bidId) && bidId > 0) {
    await ensureBidExists(bidId);
  }

  const ext = normalizeAssetUploadExt(file.originalname || '') || '.bin';
  const storedName = buildStoredFilename(file.originalname, ext);
  const storedPath = path.join(ASSET_ROOT, storedName);
  await fs.promises.writeFile(storedPath, file.buffer);

  const assetType = trimText(req.body?.asset_type).toUpperCase() || 'OTHER';

  const assetInfo = await run(
    `INSERT INTO tender_assets
      (bid_id, asset_type, original_file_name, mime_type, storage_path, file_size, status, uploaded_by_id, uploaded_by_name)
     VALUES (?, ?, ?, ?, ?, ?, 'UPLOADED', ?, ?)`,
    [
      Number.isFinite(bidId) && bidId > 0 ? bidId : null,
      assetType,
      file.originalname,
      trimText(file.mimetype) || guessMimeByExt(ext),
      storedPath,
      Number(file.size || 0),
      Number(req.user.id),
      req.user.username,
    ]
  );

  const asset = await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [assetInfo.insertId]);

  const ocr = await runAliyunOcr({ buffer: file.buffer });
  const structured = extractStructuredFields(ocr.text, assetType);

  await run(
    `INSERT INTO tender_asset_ocr_results
      (asset_id, doc_type, ocr_text, fields_json, confidence, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      doc_type = VALUES(doc_type),
      ocr_text = VALUES(ocr_text),
      fields_json = VALUES(fields_json),
      confidence = VALUES(confidence),
      status = VALUES(status),
      updated_at = NOW()`,
    [
      Number(asset.id),
      structured.fields.doc_type,
      ocr.text || null,
      JSON.stringify(structured.fields),
      Number((structured.confidence * 100).toFixed(2)),
      ocr.error ? 'FAILED' : 'AUTO_EXTRACTED',
    ]
  );

  const ocrResult = await get('SELECT * FROM tender_asset_ocr_results WHERE asset_id = ? LIMIT 1', [Number(asset.id)]);

  await logOperation({
    req,
    action: 'ASSET_UPLOAD',
    entity: 'asset',
    entityId: Number(asset.id),
    message: `上传证照文件 ${asset.original_file_name}`,
    afterData: {
      asset_id: asset.id,
      bid_id: asset.bid_id,
      asset_type: asset.asset_type,
      ocr_status: ocrResult?.status,
      ocr_error: ocr.error,
    },
  });

  res.status(201).json({
    asset,
    ocr_result: {
      ...ocrResult,
      fields_json: parseMaybeJson(ocrResult?.fields_json, {}),
      ocr_error: ocr.error || null,
    },
  });
}));

app.get('/api/tender/assets', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.query.bid_id);
  const where = [];
  const params = [];

  if (Number.isFinite(bidId) && bidId > 0) {
    where.push('a.bid_id = ?');
    params.push(bidId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT a.*, r.doc_type, r.fields_json, r.confidence, r.status AS ocr_status, r.reviewed_at, r.reviewer_name
     FROM tender_assets a
     LEFT JOIN tender_asset_ocr_results r ON r.asset_id = a.id
     ${whereSql}
     ORDER BY a.id DESC
     LIMIT 500`,
    params
  );

  res.json(
    rows.map((row) => ({
      ...row,
      fields_json: parseMaybeJson(row.fields_json, {}),
    }))
  );
}));

app.delete('/api/tender/assets/:id', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('资产ID无效', 400);

  const asset = await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]);
  if (!asset) throw appError('资产不存在', 404);

  const ocrRow = await get('SELECT * FROM tender_asset_ocr_results WHERE asset_id = ? LIMIT 1', [id]);
  const beforeData = {
    asset: { ...asset },
    ocr: ocrRow ? { ...ocrRow, fields_json: parseMaybeJson(ocrRow.fields_json, {}) } : null,
  };

  await transaction(async (tx) => {
    await tx.run('DELETE FROM tender_asset_ocr_results WHERE asset_id = ?', [id]);
    await tx.run('DELETE FROM tender_assets WHERE id = ?', [id]);
  });

  await deleteFileSafe(trimText(asset.storage_path));

  await logOperation({
    req,
    action: 'ASSET_DELETE',
    entity: 'asset',
    entityId: id,
    message: `删除证照文件 ${asset.original_file_name}`,
    beforeData,
    afterData: { deleted: true },
  });

  res.json({ ok: true, id });
}));

app.post('/api/tender/assets/:id/confirm', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('资产ID无效', 400);

  const asset = await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]);
  if (!asset) throw appError('资产不存在', 404);

  const before = await get('SELECT * FROM tender_asset_ocr_results WHERE asset_id = ? LIMIT 1', [id]);
  if (!before) throw appError('OCR结果不存在', 404);

  const docType = trimText(req.body?.doc_type) || before.doc_type;
  const fields = req.body?.fields_json && typeof req.body.fields_json === 'object'
    ? req.body.fields_json
    : parseMaybeJson(before.fields_json, {});
  const confidence = Number.isFinite(Number(req.body?.confidence)) ? Number(req.body.confidence) : Number(before.confidence || 0);

  await run(
    `UPDATE tender_asset_ocr_results
     SET doc_type = ?, fields_json = ?, confidence = ?, status = 'CONFIRMED',
         reviewer_id = ?, reviewer_name = ?, reviewed_at = NOW(), updated_at = NOW()
     WHERE asset_id = ?`,
    [docType, JSON.stringify(fields || {}), confidence, Number(req.user.id), req.user.username, id]
  );

  const row = await get('SELECT * FROM tender_asset_ocr_results WHERE asset_id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'ASSET_OCR_CONFIRM',
    entity: 'asset_ocr',
    entityId: id,
    message: `确认OCR抽取结果 ${asset.original_file_name}`,
    beforeData: before,
    afterData: row,
  });

  res.json({
    ...row,
    fields_json: parseMaybeJson(row.fields_json, {}),
  });
}));

app.get('/api/tender/assets/:id/preview', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('资产ID无效', 400);

  const asset = await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]);
  if (!asset) throw appError('资产不存在', 404);

  const rendered = await renderWatermarkedFile({ req, asset, purpose: 'preview' });

  await logOperation({
    req,
    action: 'ASSET_PREVIEW',
    entity: 'asset',
    entityId: id,
    message: `预览水印文件 ${asset.original_file_name}`,
  });

  res.setHeader('Content-Type', rendered.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.resolve(rendered.path));
}));

app.get('/api/tender/assets/:id/download', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('资产ID无效', 400);

  const asset = await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]);
  if (!asset) throw appError('资产不存在', 404);

  const rendered = await renderWatermarkedFile({ req, asset, purpose: 'download' });

  await logOperation({
    req,
    action: 'ASSET_DOWNLOAD',
    entity: 'asset',
    entityId: id,
    message: `下载水印文件 ${asset.original_file_name}`,
  });

  res.setHeader('Content-Type', rendered.mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rendered.filename)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.resolve(rendered.path));
}));

app.get('/api/tender/ai/models', asyncHandler(async (req, res) => {
  const canManage = hasPermission(req.user, 'tender:ai:manage');
  const canUse = hasPermission(req.user, 'tender:ai:use');
  if (!canManage && !canUse) throw appError('无权限', 403);

  const whereSql = canManage ? '' : 'WHERE is_enabled = 1';
  const rows = await query(`SELECT * FROM tender_ai_models ${whereSql} ORDER BY is_default DESC, id ASC`);

  res.json(
    rows.map((item) => ({
      ...item,
      api_key_enc: maskSecret(item.api_key_enc),
      extra_headers_json: parseMaybeJson(item.extra_headers_json, {}),
    }))
  );
}));

app.post('/api/tender/ai/models', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const name = trimText(req.body?.name);
  const model_key = trimText(req.body?.model_key).toLowerCase();
  const provider_type = trimText(req.body?.provider_type || 'custom').toLowerCase();
  const base_url = trimText(req.body?.base_url);
  const model_name = trimText(req.body?.model_name);
  const api_key = trimText(req.body?.api_key);

  if (!name) throw appError('name不能为空', 400);
  if (!model_key) throw appError('model_key不能为空', 400);
  if (!base_url) throw appError('base_url不能为空', 400);
  if (!model_name) throw appError('model_name不能为空', 400);
  if (!api_key) throw appError('api_key不能为空', 400);
  if (!CONFIG_SECRET_KEY) throw appError('请配置CONFIG_SECRET_KEY后再保存敏感信息', 400);

  const info = await run(
    `INSERT INTO tender_ai_models
      (model_key, name, provider_type, base_url, model_name, api_key_enc, extra_headers_json, timeout_ms, max_tokens, temperature_default, is_enabled, is_default, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      model_key,
      name,
      provider_type,
      base_url,
      model_name,
      encryptValue(api_key),
      JSON.stringify(req.body?.extra_headers_json && typeof req.body.extra_headers_json === 'object' ? req.body.extra_headers_json : {}),
      Math.max(3000, Number(req.body?.timeout_ms || 20000)),
      Math.max(256, Number(req.body?.max_tokens || 4096)),
      Number.isFinite(Number(req.body?.temperature_default)) ? Number(req.body.temperature_default) : 0.3,
      req.body?.is_enabled === undefined ? 1 : req.body?.is_enabled ? 1 : 0,
      Number(req.user.id),
      req.user.username,
      Number(req.user.id),
      req.user.username,
    ]
  );

  const row = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [info.insertId]);

  await logOperation({
    req,
    action: 'AI_MODEL_CREATE',
    entity: 'ai_model',
    entityId: row.id,
    message: `新增模型 ${row.model_key}`,
    afterData: { ...row, api_key_enc: SECRET_MASK },
  });

  res.status(201).json({
    ...row,
    api_key_enc: SECRET_MASK,
    extra_headers_json: parseMaybeJson(row.extra_headers_json, {}),
  });
}));

app.put('/api/tender/ai/models/:id', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模型ID无效', 400);

  const before = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('模型不存在', 404);

  const base_url = req.body?.base_url === undefined ? before.base_url : trimText(req.body?.base_url);
  const model_name = req.body?.model_name === undefined ? before.model_name : trimText(req.body?.model_name);
  const extra_headers_json = req.body?.extra_headers_json === undefined
    ? before.extra_headers_json
    : JSON.stringify(req.body?.extra_headers_json && typeof req.body.extra_headers_json === 'object' ? req.body.extra_headers_json : {});

  let api_key_enc = before.api_key_enc;
  if (req.body?.api_key !== undefined) {
    const incoming = trimText(req.body?.api_key);
    if (incoming && incoming !== SECRET_MASK) {
      if (!CONFIG_SECRET_KEY) throw appError('请配置CONFIG_SECRET_KEY后再保存敏感信息', 400);
      api_key_enc = encryptValue(incoming);
    }
  }

  await run(
    `UPDATE tender_ai_models
     SET name = ?, provider_type = ?, base_url = ?, model_name = ?, api_key_enc = ?, extra_headers_json = ?,
         timeout_ms = ?, max_tokens = ?, temperature_default = ?, is_enabled = ?,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      trimText(req.body?.name) || before.name,
      trimText(req.body?.provider_type || before.provider_type) || before.provider_type,
      base_url,
      model_name,
      api_key_enc,
      extra_headers_json,
      Math.max(3000, Number(req.body?.timeout_ms || before.timeout_ms || 20000)),
      Math.max(256, Number(req.body?.max_tokens || before.max_tokens || 4096)),
      Number.isFinite(Number(req.body?.temperature_default)) ? Number(req.body.temperature_default) : Number(before.temperature_default || 0.3),
      req.body?.is_enabled === undefined ? Number(before.is_enabled || 0) : req.body?.is_enabled ? 1 : 0,
      Number(req.user.id),
      req.user.username,
      id,
    ]
  );

  const row = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'AI_MODEL_UPDATE',
    entity: 'ai_model',
    entityId: id,
    message: `更新模型 ${before.model_key}`,
    beforeData: { ...before, api_key_enc: SECRET_MASK },
    afterData: { ...row, api_key_enc: SECRET_MASK },
  });

  res.json({
    ...row,
    api_key_enc: maskSecret(row.api_key_enc),
    extra_headers_json: parseMaybeJson(row.extra_headers_json, {}),
  });
}));

app.post('/api/tender/ai/models/:id/default', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模型ID无效', 400);
  const model = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [id]);
  if (!model) throw appError('模型不存在', 404);
  if (Number(model.is_enabled || 0) !== 1) throw appError('模型已禁用，不能设为默认', 400);

  await transaction(async (tx) => {
    await tx.run('UPDATE tender_ai_models SET is_default = 0 WHERE is_default = 1');
    await tx.run('UPDATE tender_ai_models SET is_default = 1 WHERE id = ?', [id]);
  });

  await logOperation({
    req,
    action: 'AI_MODEL_DEFAULT',
    entity: 'ai_model',
    entityId: id,
    message: `设置默认模型 ${model.model_key}`,
  });

  res.json({ ok: true });
}));

app.get('/api/tender/ai/prompts', requirePermission('tender:ai:manage'), asyncHandler(async (_req, res) => {
  const rows = await query('SELECT * FROM tender_ai_prompts ORDER BY id ASC');
  res.json(rows);
}));

app.put('/api/tender/ai/prompts/:taskType', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const taskType = trimText(req.params.taskType).toUpperCase();
  if (!['OCR_STRUCTURED', 'REWRITE', 'PROOFREAD'].includes(taskType)) throw appError('不支持的任务类型', 400);
  const promptTemplate = trimText(req.body?.prompt_template);
  if (!promptTemplate) throw appError('prompt_template不能为空', 400);

  const before = await get('SELECT * FROM tender_ai_prompts WHERE task_type = ? LIMIT 1', [taskType]);

  await run(
    `INSERT INTO tender_ai_prompts (task_type, prompt_template, is_active, updated_by_id, updated_by_name)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
      prompt_template = VALUES(prompt_template),
      is_active = VALUES(is_active),
      updated_by_id = VALUES(updated_by_id),
      updated_by_name = VALUES(updated_by_name),
      updated_at = NOW()`,
    [taskType, promptTemplate, Number(req.user.id), req.user.username]
  );

  const after = await get('SELECT * FROM tender_ai_prompts WHERE task_type = ? LIMIT 1', [taskType]);

  await logOperation({
    req,
    action: 'AI_PROMPT_UPDATE',
    entity: 'ai_prompt',
    entityId: Number(after.id),
    message: `更新提示词 ${taskType}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

app.post('/api/tender/ai/tasks/ocr-structured', requirePermission('tender:ai:use'), asyncHandler(async (req, res) => {
  const text = trimText(req.body?.ocr_text);
  const modelId = Number(req.body?.model_id);

  const result = await runAiTask({
    req,
    taskType: 'OCR_STRUCTURED',
    inputText: text,
    modelId: Number.isFinite(modelId) ? modelId : null,
  });

  res.json(result);
}));

app.post('/api/tender/ai/tasks/rewrite', requirePermission('tender:ai:use'), asyncHandler(async (req, res) => {
  const text = trimText(req.body?.input_text);
  const modelId = Number(req.body?.model_id);
  const style = trimText(req.body?.style || '正式、专业、简洁');

  const result = await runAiTask({
    req,
    taskType: 'REWRITE',
    inputText: text,
    modelId: Number.isFinite(modelId) ? modelId : null,
    extraSystemPrompt: `改写风格要求：${style}`,
  });

  res.json(result);
}));

app.post('/api/tender/ai/tasks/proofread', requirePermission('tender:ai:use'), asyncHandler(async (req, res) => {
  const text = trimText(req.body?.input_text);
  const modelId = Number(req.body?.model_id);

  const result = await runAiTask({
    req,
    taskType: 'PROOFREAD',
    inputText: text,
    modelId: Number.isFinite(modelId) ? modelId : null,
  });

  res.json(result);
}));

app.get('/api/tender/ai/logs', asyncHandler(async (req, res) => {
  const canAudit = hasPermission(req.user, 'tender:audit:read');
  const canManage = hasPermission(req.user, 'tender:ai:manage');
  if (!canAudit && !canManage) throw appError('无权限', 403);

  const { task_type, status, operator_name, date_from, date_to, limit } = req.query || {};
  const where = [];
  const params = [];

  if (task_type) {
    where.push('task_type = ?');
    params.push(task_type);
  }
  if (status) {
    where.push('status = ?');
    params.push(String(status).toUpperCase());
  }
  if (operator_name) {
    where.push('operator_name LIKE ?');
    params.push(`%${operator_name}%`);
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
  const take = Math.min(Math.max(Number(limit || 200), 1), 2000);

  const rows = await query(
    `SELECT *
     FROM tender_ai_task_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, take]
  );

  res.json(rows);
}));

app.get('/api/tender/audit/logs', requirePermission('tender:audit:read'), asyncHandler(async (req, res) => {
  const { username, action, entity, date_from, date_to, keyword, limit } = req.query || {};
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
  if (keyword) {
    where.push('(message LIKE ? OR before_data LIKE ? OR after_data LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const take = Math.min(Math.max(Number(limit || 300), 1), 5000);

  const rows = await query(
    `SELECT *
     FROM tender_operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, take]
  );

  res.json(rows);
}));

app.get('/api/tender/audit/logs/export', requirePermission('tender:audit:read'), asyncHandler(async (req, res) => {
  const { username, action, entity, date_from, date_to, keyword } = req.query || {};
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
  if (keyword) {
    where.push('(message LIKE ? OR before_data LIKE ? OR after_data LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT id, username, user_role, action, entity, entity_id, message, before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at
     FROM tender_operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT 10000`,
    params
  );

  const csv = toCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'username', label: '用户' },
    { key: 'user_role', label: '角色' },
    { key: 'action', label: '动作' },
    { key: 'entity', label: '对象' },
    { key: 'entity_id', label: '对象ID' },
    { key: 'message', label: '说明' },
    { key: 'before_data', label: '变更前' },
    { key: 'after_data', label: '变更后' },
    { key: 'prev_hash', label: '前一条签名' },
    { key: 'signature', label: '当前签名' },
    { key: 'sign_version', label: '签名版本' },
    { key: 'request_ip', label: '来源IP' },
    { key: 'created_at', label: '时间' },
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tender_operation_logs.csv"`);
  res.send(csv);
}));

app.get('/api/tender/audit/verify', requirePermission('tender:audit:read'), asyncHandler(async (req, res) => {
  const result = await verifyAuditChain(req.query.limit);
  res.json(result);
}));

app.get('/api/tender/config', requirePermission('tender:config:manage'), asyncHandler(async (_req, res) => {
  const configs = await getSystemConfigs();
  res.json(buildTenderConfigResponse(configs));
}));

app.post('/api/tender/config', requirePermission('tender:config:manage'), asyncHandler(async (req, res) => {
  const incoming = req.body || {};
  const hasRetention = incoming.audit_retention_days !== undefined;
  const hasOcrTimeout = incoming.ocr_timeout_ms !== undefined;
  const hasOcrSecret = incoming.ocr_access_key_secret !== undefined;
  const hasOcrEnabled = incoming.ocr_enabled !== undefined;
  const hasOcrAccessKeyId = incoming.ocr_access_key_id !== undefined;
  const hasOcrEndpoint = incoming.ocr_endpoint !== undefined;
  const hasOcrApiVersion = incoming.ocr_api_version !== undefined;

  if (hasRetention) {
    const nextRetention = Number(incoming.audit_retention_days);
    if (!Number.isFinite(nextRetention) || nextRetention < 30) {
      throw appError('audit_retention_days 不能小于30天', 400);
    }
  }

  if (hasOcrTimeout) {
    const timeout = Number(incoming.ocr_timeout_ms);
    if (!Number.isFinite(timeout) || timeout < 3000 || timeout > 120000) {
      throw appError('ocr_timeout_ms 需在3000~120000毫秒之间', 400);
    }
  }

  const before = await getSystemConfigs();

  if (hasRetention) {
    await upsertSystemConfig('audit_retention_days', Math.floor(Number(incoming.audit_retention_days)));
  }

  if (hasOcrEnabled) {
    await upsertSystemConfig('ocr_enabled', normalizeBoolean(incoming.ocr_enabled, true));
  }

  if (hasOcrAccessKeyId) {
    await upsertSystemConfig('ocr_access_key_id', trimText(incoming.ocr_access_key_id));
  }

  if (hasOcrEndpoint) {
    const endpoint = trimText(incoming.ocr_endpoint);
    await upsertSystemConfig('ocr_endpoint', endpoint || OCR_ENDPOINT_DEFAULT);
  }

  if (hasOcrApiVersion) {
    const apiVersion = trimText(incoming.ocr_api_version);
    await upsertSystemConfig('ocr_api_version', apiVersion || OCR_API_VERSION_DEFAULT);
  }

  if (hasOcrTimeout) {
    await upsertSystemConfig('ocr_timeout_ms', normalizePositiveNumber(incoming.ocr_timeout_ms, OCR_TIMEOUT_MS_DEFAULT, 3000, 120000));
  }

  if (hasOcrSecret) {
    const incomingSecret = trimText(incoming.ocr_access_key_secret);
    if (!incomingSecret) {
      await upsertSystemConfig('ocr_access_key_secret_enc', '');
    } else if (incomingSecret !== SECRET_MASK) {
      if (!CONFIG_SECRET_KEY) throw appError('请配置CONFIG_SECRET_KEY后再保存敏感信息', 400);
      await upsertSystemConfig('ocr_access_key_secret_enc', encryptValue(incomingSecret));
    }
  }

  const after = await getSystemConfigs();
  const beforeSafe = buildTenderConfigResponse(before);
  const afterSafe = buildTenderConfigResponse(after);

  await logOperation({
    req,
    action: 'CONFIG_UPDATE',
    entity: 'system_config',
    entityId: 0,
    message: '更新系统配置',
    beforeData: beforeSafe,
    afterData: afterSafe,
  });

  res.json(afterSafe);
}));

app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode || err?.status || 500);
  const message = trimText(err?.message) || '服务器内部错误';
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

const startCleanupJob = () => {
  const timer = setInterval(() => {
    performAuditCleanup().catch((err) => {
      console.error('[tender] audit cleanup failed:', err?.message || err);
    });
  }, AUDIT_CLEANUP_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
};

const start = async () => {
  validateSecurityBootstrap();
  await initDb();
  const existingRetention = await get('SELECT id FROM tender_system_configs WHERE `key` = ? LIMIT 1', ['audit_retention_days']);
  if (!existingRetention) {
    await upsertSystemConfig('audit_retention_days', AUDIT_RETENTION_DAYS_DEFAULT);
  }
  startCleanupJob();

  app.listen(PORT, () => {
    console.log(`Tender API running at http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  console.error('[tender] failed to start:', err);
  process.exit(1);
});

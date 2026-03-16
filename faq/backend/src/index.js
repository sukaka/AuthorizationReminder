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
const {
  collectCategoryForceDeletePlan,
  getCategoryDeleteGuard,
  normalizeCategoryDeleteIds,
  orderCategoryBatchDeleteIds,
  summarizeCategoryBatchDeleteResults,
  summarizeCategoryForceDeleteResults,
} = require('./category-delete');
const {
  getArticleBatchActionGuard,
} = require('./article-batch');
const {
  canManageDepartmentContent,
  canReviewDepartmentRequest,
  getManagedDepartmentCodes,
  getUserDepartmentCode,
  normalizeDepartmentCode,
  normalizeLibraryScope,
  resolveArticleAccess,
  sanitizeArticleForList,
} = require('./library-access');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');
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

const PORT = Number(process.env.PORT || 5186);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'faq').trim() || 'faq';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';
const FILE_MAX_BYTES = Math.max(1024 * 100, Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 20) * 1024 * 1024);
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || '/data/faq/uploads');
const PREVIEW_ROOT = path.resolve(process.env.PREVIEW_ROOT || '/data/faq/previews');
const DRAFT_ROOT = path.resolve(process.env.DRAFT_ROOT || '/data/faq/drafts');
const EDITABLE_ROOT = path.resolve(process.env.EDITABLE_ROOT || '/data/faq/editable');
const LIBREOFFICE_BIN = String(process.env.LIBREOFFICE_BIN || 'soffice').trim() || 'soffice';
const EDITOR_LOCK_MINUTES = Math.max(1, Number(process.env.EDITOR_LOCK_MINUTES || 20));
const DOC_EDITOR_PROVIDER = String(process.env.DOC_EDITOR_PROVIDER || 'onlyoffice').trim();
const DOC_EDITOR_FILE_BASE_URL = String(process.env.DOC_EDITOR_FILE_BASE_URL || 'http://faq-api:5186').trim().replace(/\/+$/, '');
const DOC_EDITOR_CALLBACK_BASE_URL = String(process.env.DOC_EDITOR_CALLBACK_BASE_URL || 'http://faq-api:5186').trim().replace(/\/+$/, '');
const DOC_EDITOR_PUBLIC_PATH = String(process.env.DOC_EDITOR_PUBLIC_PATH || '/doc-editor').trim();
const DOC_EDITOR_JWT_SECRET = String(process.env.DOC_EDITOR_JWT_SECRET || 'faq-onlyoffice-jwt').trim();
const DOC_EDITOR_FORCE_VIEW_ONLY = process.env.DOC_EDITOR_FORCE_VIEW_ONLY === 'true';
const DOC_EDITOR_DEBUG = process.env.DOC_EDITOR_DEBUG === 'true';
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
const LIST_MAX_LIMIT = Math.max(10, Math.min(500, Number(process.env.FAQ_LIST_MAX_LIMIT || 200)));
const RECYCLE_RETENTION_DAYS_DEFAULT = Number(process.env.FAQ_RECYCLE_RETENTION_DAYS || 30) === 7 ? 7 : 30;
const RECYCLE_CLEANUP_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.FAQ_RECYCLE_CLEANUP_INTERVAL_MS || 10 * 60 * 1000));
const PUBLISH_NOTE_MAX_LEN = 500;
const DIFF_MAX_SEGMENTS = Math.max(100, Math.min(1000, Number(process.env.FAQ_DIFF_MAX_SEGMENTS || 500)));
const DIFF_MAX_ENTRIES = Math.max(100, Math.min(1200, Number(process.env.FAQ_DIFF_MAX_ENTRIES || 600)));
const SEARCH_SUGGESTION_LIMIT = Math.max(3, Math.min(12, Number(process.env.FAQ_SEARCH_SUGGESTION_LIMIT || 6)));
const REMINDER_WEBHOOK_URL = String(process.env.REMINDER_WEBHOOK_URL || '').trim();
const REMINDER_WEBHOOK_TOKEN = String(process.env.REMINDER_WEBHOOK_TOKEN || '').trim();
const REMINDER_WEBHOOK_TIMEOUT_MS = Math.max(1000, Number(process.env.REMINDER_WEBHOOK_TIMEOUT_MS || 5000));
const EDITOR_COLLAB_MODE = 'single';
const SECTION_LOCK_MINUTES = Math.max(5, Number(process.env.SECTION_LOCK_MINUTES || 90));
const SMART_PIN_TOPN = Math.max(3, Math.min(20, Number(process.env.SMART_PIN_TOPN || 8)));
const SMART_PIN_REFRESH_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.SMART_PIN_REFRESH_INTERVAL_MS || 15 * 60 * 1000));
const EVENT_OUTBOX_FLUSH_INTERVAL_MS = Math.max(30 * 1000, Number(process.env.FAQ_EVENT_OUTBOX_FLUSH_INTERVAL_MS || 60 * 1000));
const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);

const FEEDBACK_REASON_LABELS = {
  no_match: '问题不匹配',
  unclear_steps: '步骤不清晰',
  outdated: '内容已过期',
  permission_issue: '权限或环境受限',
  missing_context: '缺少前置条件',
  other: '其他',
};

const DEFAULT_EDITOR_SECTIONS = [
  { key: 'technical', name: '技术部分' },
  { key: 'business', name: '商务部分' },
  { key: 'plan', name: '实施计划' },
  { key: 'risk', name: '风险与应对' },
];

const ALLOWED_UPLOAD_EXTS = new Set(['.doc', '.docx', '.pdf']);
const ALLOWED_UPLOAD_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]);

const defaultOrigins = ['http://localhost:8085', 'http://127.0.0.1:8085'].map(normalizeOrigin);
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
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
app.use(express.json({ limit: '6mb' }));

for (const dir of [UPLOAD_ROOT, PREVIEW_ROOT, DRAFT_ROOT, EDITABLE_ROOT]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const formatDateTime = (date) => {
  if (!(date instanceof Date)) return null;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const trimText = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value).trim());

const toPositiveInt = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

const toBoundedLimit = (value, fallback = 20) => {
  const n = toPositiveInt(value, fallback);
  return Math.min(n, LIST_MAX_LIMIT);
};

const normalizeRetentionDays = (value, fallback = RECYCLE_RETENTION_DAYS_DEFAULT) => {
  const n = Number(value);
  if (n === 7 || n === 30) return n;
  return fallback;
};

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
  if (isWeakSecret(DOC_EDITOR_JWT_SECRET, 32)) {
    problems.push('DOC_EDITOR_JWT_SECRET 过弱（生产建议至少32位随机值）');
  }
  if (!DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST.length) {
    problems.push('DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST 未配置，无法约束回调下载来源');
  }
  if (!problems.length) return;
  const text = `[SECURITY][faq] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) throw new Error(text);
  console.warn(`${text}。当前为非严格模式，仅告警。`);
};

const appError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const debugDocEditor = (event, payload = null) => {
  if (!DOC_EDITOR_DEBUG) return;
  try {
    const tail = payload ? ` ${stableStringify(payload)}` : '';
    console.log(`[faq-doc-editor] ${event}${tail}`);
  } catch {
    console.log(`[faq-doc-editor] ${event}`);
  }
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

const resolveDocEditorDownloadUrl = (value) => {
  const text = trimText(value);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw appError('回调文件URL无效', 400);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw appError('回调文件URL协议不受支持', 400);
  }
  if (parsed.username || parsed.password) {
    throw appError('回调文件URL不合法', 400);
  }
  const host = normalizeHost(parsed.hostname);
  if (DOC_EDITOR_DOWNLOAD_HOST_ALLOWLIST.includes(host)) {
    return parsed.toString();
  }
  const message = `[SECURITY][faq] 回调下载域名未授权: ${host || 'unknown'}`;
  if (SECURITY_STRICT_MODE) {
    throw appError('回调文件URL不在允许列表', 403);
  }
  console.warn(`${message}，非严格模式放行`);
  return parsed.toString();
};

const downloadDocEditorFile = async (value, timeoutMs = 15000) => {
  const url = resolveDocEditorDownloadUrl(value);
  const remoteResp = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
  if (!remoteResp.ok) throw appError('拉取编辑文件失败', 502);

  const contentLength = Number(remoteResp.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > DOC_EDITOR_DOWNLOAD_MAX_BYTES) {
    throw appError('回调文件过大', 413);
  }

  const arrayBuffer = await remoteResp.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (!buf.length) throw appError('回调文件为空', 400);
  if (buf.length > DOC_EDITOR_DOWNLOAD_MAX_BYTES) throw appError('回调文件过大', 413);
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
  } catch (_err) {
    throw appError('统一登录返回异常', 401);
  }

  const user = data?.user;
  const apps = Array.isArray(data?.apps) ? data.apps : [];
  const scope = data?.scope && typeof data.scope === 'object' ? data.scope : {};
  if (!user || user.id === undefined || !user.username) throw appError('登录状态无效', 401);
  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) throw appError('无权限访问文档管理系统', 403);

  return {
    user: {
      id: Number(user.id),
      username: String(user.username || ''),
      role: String(user.role || 'viewer'),
      scope: {
        department: scope.department || null,
        managedDepartments: Array.isArray(scope.managedDepartments) ? scope.managedDepartments : [],
        isDepartmentDocAdmin: scope.isDepartmentDocAdmin === true,
      },
    },
    apps,
  };
};

const getClientIp = (req) => {
  return trimText(req.ip) || trimText(req.socket?.remoteAddress) || '';
};

const authRequired = asyncHandler(async (req, _res, next) => {
  if (req.path === '/health') return next();
  const token = extractBearerToken(req.headers.authorization) || extractCookieToken(req.headers.cookie);
  if (!token) throw appError('未登录', 401);
  if (token.length < 16 || token.length > 4096) throw appError('登录凭证非法', 401);

  const auth = await introspectToken(token);
  req.user = auth.user;
  req.authApps = auth.apps;
  next();
});

const getUserRole = (req) => trimText(req.user?.role).toLowerCase();
const isAdmin = (req) => getUserRole(req) === 'admin';
const isAuditor = (req) => getUserRole(req) === 'auditor';
const isEditor = (req) => getUserRole(req) === 'editor';
const isReviewer = (req) => getUserRole(req) === 'reviewer';
const canWriteFaq = (req) => isAdmin(req) || isEditor(req);
const canReviewPublish = (req) => isAdmin(req) || isReviewer(req);
const getRequestDepartmentCode = (req) => getUserDepartmentCode(req.user);
const getRequestManagedDepartments = (req) => getManagedDepartmentCodes(req.user);
const isDepartmentDocAdmin = (req, departmentCode) => canReviewDepartmentRequest(req.user, departmentCode);
const canManageGlobalLibrary = (req) => isAdmin(req);
const canManageDepartmentLibrary = (req, departmentCode) => canManageDepartmentContent(req.user, departmentCode);
const canUseGlobalLibrary = (req) => !['sysadmin', 'auditor'].includes(getUserRole(req)) || isAdmin(req);

const requireAdmin = (req, _res, next) => {
  if (!isAdmin(req)) return next(appError('仅管理员可执行该操作', 403));
  return next();
};

const requireWriter = (req, _res, next) => {
  if (!canWriteFaq(req)) return next(appError('仅管理员或编辑可执行该操作', 403));
  return next();
};

const requireReviewer = (req, _res, next) => {
  if (!canReviewPublish(req)) return next(appError('仅管理员或审核员可执行该操作', 403));
  return next();
};

const requireAuditor = (req, _res, next) => {
  if (!isAuditor(req)) return next(appError('仅审计管理员可查看该内容', 403));
  return next();
};

const toJson = (value, fallback = null) => {
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

const parseTags = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => trimText(item)).filter(Boolean))).slice(0, 20);
  }
  const text = trimText(value);
  if (!text) return [];
  return Array.from(new Set(text.split(/[，,、]/).map((item) => trimText(item)).filter(Boolean))).slice(0, 20);
};

const normalizeAccessDurationCode = (value) => {
  const text = trimText(value).toLowerCase();
  if (text === '30d') return '30d';
  if (text === 'long_term') return 'long_term';
  return '7d';
};

const buildGrantExpiresAt = (durationCode) => {
  const now = Date.now();
  if (durationCode === 'long_term') return null;
  const days = durationCode === '30d' ? 30 : 7;
  return formatDateTime(new Date(now + days * 24 * 60 * 60 * 1000));
};

const getArticleActiveGrant = async ({ articleId, userId }) => {
  if (!Number.isFinite(Number(articleId)) || !Number.isFinite(Number(userId))) return null;
  return get(
    `SELECT *
     FROM faq_article_access_grants
     WHERE article_id = ?
       AND grantee_id = ?
       AND status = 'approved'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY id DESC
     LIMIT 1`,
    [Number(articleId), Number(userId)]
  );
};

const getArticleWithCategory = async (articleId) => {
  return get(
    `SELECT a.*, c.name AS category_name
     FROM faq_articles a
     LEFT JOIN faq_categories c ON c.id = a.category_id
     WHERE a.id = ?`,
    [articleId]
  );
};

const resolveArticleAccessForRequest = async (req, article) => {
  const activeGrant = await getArticleActiveGrant({
    articleId: article?.id,
    userId: Number(req.user?.id) || 0,
  });
  return resolveArticleAccess({
    user: req.user,
    article,
    activeGrant,
  });
};

const ensureReadableArticle = async (req, articleId) => {
  const article = await getArticleWithCategory(articleId);
  if (!article) throw appError('文章不存在', 404);
  const access = await resolveArticleAccessForRequest(req, article);
  if (!access.canRead) {
    throw appError(access.visibility === 'restricted' ? '当前仅可查看题头，请先申请权限' : '无权查看该文档', 403);
  }
  return { article, access };
};

const ensureManageableArticle = async (req, articleId, options = {}) => {
  const { includeDeleted = false } = options;
  const article = await ensureArticleExists(articleId, { includeDeleted });
  const access = await resolveArticleAccessForRequest(req, article);
  if (!access.canManage && !canManageDepartmentLibrary(req, article.department_code)) {
    throw appError('仅管理员、编辑或部门文档管理员可管理该文档', 403);
  }
  return { article, access };
};

const normalizeArticleScopeInput = (req, payload = {}, fallbackDepartmentCode = '') => {
  if (isAdmin(req)) {
    const libraryScope = normalizeLibraryScope(payload.library_scope);
    const departmentCode = normalizeDepartmentCode(payload.department_code || fallbackDepartmentCode);
    if (libraryScope === 'global') {
      return { library_scope: 'global', department_code: null };
    }
    if (!departmentCode) throw appError('部门库文档必须选择归属部门', 400);
    return { library_scope: 'department', department_code: departmentCode };
  }
  const departmentCode = normalizeDepartmentCode(payload.department_code || fallbackDepartmentCode || getRequestDepartmentCode(req));
  if (!departmentCode) throw appError('当前账号未配置主归属部门，无法创建部门库文档', 400);
  if (!canManageDepartmentLibrary(req, departmentCode)) {
    throw appError('仅当前部门编辑或部门文档管理员可管理目标部门文档', 403);
  }
  return { library_scope: 'department', department_code: departmentCode };
};

const buildAccessRequestNoticePayload = ({ type, article, requestRow, reviewRow }) => ({
  type,
  article_id: Number(article?.id || 0),
  article_title: String(article?.title || ''),
  target_department_code: String(article?.department_code || ''),
  request_id: Number(requestRow?.id || 0),
  reviewer: reviewRow
    ? {
      id: Number(reviewRow.reviewed_by_id || 0),
      username: String(reviewRow.reviewed_by_name || ''),
    }
    : null,
});

const buildInClause = (values = []) => values.map(() => '?').join(',');

const buildVisibleDepartmentCodes = (req, includeManaged = false) => {
  const values = [getRequestDepartmentCode(req)];
  if (includeManaged) values.push(...getRequestManagedDepartments(req));
  return Array.from(new Set(values.map((item) => normalizeDepartmentCode(item)).filter(Boolean)));
};

const buildCategoryVisibilityWhere = (req, includeManaged = false) => {
  if (isAdmin(req)) return { clause: '1=1', params: [] };
  const departments = buildVisibleDepartmentCodes(req, includeManaged);
  const clauses = [];
  const params = [];
  if (canUseGlobalLibrary(req)) {
    clauses.push(`(library_scope = 'global')`);
  }
  if (departments.length) {
    clauses.push(`(library_scope = 'department' AND department_code IN (${buildInClause(departments)}))`);
    params.push(...departments);
  }
  if (!clauses.length) return { clause: '0=1', params: [] };
  return { clause: clauses.join(' OR '), params };
};

const ensureCategoryMatchesLibrary = async ({ categoryId, libraryScope, departmentCode }) => {
  if (!Number.isFinite(Number(categoryId)) || Number(categoryId) <= 0) return null;
  const category = await get('SELECT * FROM faq_categories WHERE id = ?', [Number(categoryId)]);
  if (!category) throw appError('分类不存在', 404);
  if (normalizeLibraryScope(category.library_scope) !== normalizeLibraryScope(libraryScope)) {
    throw appError('文档与分类的文库范围不一致', 400);
  }
  if (normalizeLibraryScope(libraryScope) === 'department') {
    if (normalizeDepartmentCode(category.department_code) !== normalizeDepartmentCode(departmentCode)) {
      throw appError('部门库文档只能挂到本部门分类', 400);
    }
  }
  return category;
};

const getGrantMapForArticles = async ({ articleIds, userId }) => {
  const ids = Array.from(new Set((Array.isArray(articleIds) ? articleIds : []).map((item) => Number(item)).filter((item) => item > 0)));
  if (!ids.length || !Number.isFinite(Number(userId)) || Number(userId) <= 0) return new Map();
  const rows = await query(
    `SELECT *
     FROM faq_article_access_grants
     WHERE grantee_id = ?
       AND article_id IN (${buildInClause(ids)})
       AND status = 'approved'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [Number(userId), ...ids]
  );
  return new Map(rows.map((item) => [Number(item.article_id), item]));
};

const articleMatchesKeyword = ({ article, keyword, access }) => {
  const key = trimText(keyword).toLowerCase();
  if (!key) return true;
  const title = trimText(article.title).toLowerCase();
  if (title.includes(key)) return true;
  if (access.visibility !== 'full') return false;
  const haystack = [
    trimText(article.summary),
    trimText(article.tags_json),
    trimText(article.matched_search_text),
  ].join(' ').toLowerCase();
  return haystack.includes(key);
};

const normalizeStatus = (value) => {
  const text = trimText(value).toLowerCase();
  if (text === 'published') return 'published';
  if (text === 'archived') return 'archived';
  return 'draft';
};

const normalizePublishNote = (value) => {
  const text = trimText(value)
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, PUBLISH_NOTE_MAX_LEN);
};

const normalizeFeedbackReasonCode = (value) => {
  const code = trimText(value).toLowerCase();
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(FEEDBACK_REASON_LABELS, code) ? code : 'other';
};

const normalizeUploadExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_UPLOAD_EXTS.has(ext) ? ext : '';
};

const buildStoredFilename = (filename, extOverride = '') => {
  const ext = extOverride || normalizeUploadExt(filename) || path.extname(String(filename || '')).toLowerCase() || '';
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
};

const guessMimeByExt = (ext) => {
  const normalized = trimText(ext).toLowerCase();
  if (normalized === '.pdf') return 'application/pdf';
  if (normalized === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalized === '.doc') return 'application/msword';
  if (normalized === '.html') return 'text/html; charset=utf-8';
  return 'application/octet-stream';
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const convertDocxToHtml = async (inputPath, outputPath, title = '文档预览') => {
  const result = await mammoth.convertToHtml({ path: inputPath });
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    html,body{margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827}
    .wrap{max-width:980px;margin:24px auto;padding:0 16px}
    .card{background:#fff;border:1px solid rgba(148,163,184,.35);border-radius:14px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.08)}
    .mammoth-preview h1,.mammoth-preview h2,.mammoth-preview h3{margin-top:1.1em}
    .mammoth-preview table{border-collapse:collapse;width:100%}
    .mammoth-preview th,.mammoth-preview td{border:1px solid #e5e7eb;padding:8px}
    .mammoth-preview img{max-width:100%}
  </style>
</head>
<body>
  <div class="wrap"><div class="card mammoth-preview">${result.value || ''}</div></div>
</body>
</html>`;
  await fs.promises.writeFile(outputPath, html, 'utf8');
  return outputPath;
};

const normalizeSearchText = (value, maxLen = 120000) => {
  const compact = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.slice(0, maxLen);
};

const extractDocxSearchText = async (docxPath) => {
  const target = trimText(docxPath);
  if (!target) return '';
  try {
    const result = await mammoth.extractRawText({ path: target });
    return normalizeSearchText(result?.value);
  } catch {
    return '';
  }
};

const buildSearchTextByUpload = async ({ ext, uploadPath, editablePath }) => {
  const normalizedExt = trimText(ext).toLowerCase();
  if (normalizedExt === '.docx') return extractDocxSearchText(uploadPath);
  if (normalizedExt === '.doc') return extractDocxSearchText(editablePath);
  return '';
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
    throw new Error(`未找到转换产物: ${outPath}`);
  }
  return outPath;
};

const copyToManagedPath = async (srcPath, targetRoot, targetExt) => {
  const filename = buildStoredFilename(path.basename(srcPath), targetExt);
  const targetPath = path.join(targetRoot, filename);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.copyFile(srcPath, targetPath);
  return targetPath;
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
    // ignore cleanup error
  }
};

const logOperation = async ({ req, articleId = null, action, message = '', beforeData = null, afterData = null }) => {
  await run(
    `INSERT INTO faq_operation_logs
      (article_id, action, message, before_data, after_data, operator_id, operator_name, operator_role, request_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number.isFinite(Number(articleId)) ? Number(articleId) : null,
      trimText(action).slice(0, 64) || 'UNKNOWN',
      trimText(message).slice(0, 255) || null,
      stableStringify(beforeData),
      stableStringify(afterData),
      Number.isFinite(Number(req?.user?.id)) ? Number(req.user.id) : null,
      trimText(req?.user?.username).slice(0, 128) || null,
      trimText(req?.user?.role).slice(0, 32) || null,
      trimText(getClientIp(req)).slice(0, 64) || null,
    ]
  );
};

const loadCategoryDeleteState = async (id) => {
  const category = await get('SELECT * FROM faq_categories WHERE id = ?', [id]);
  if (!category) {
    return {
      category: null,
      linkedCount: 0,
      childCount: 0,
    };
  }

  const [linked, child] = await Promise.all([
    get('SELECT COUNT(1) AS count FROM faq_articles WHERE category_id = ? AND is_deleted = 0', [id]),
    get('SELECT COUNT(1) AS count FROM faq_categories WHERE parent_id = ?', [id]),
  ]);

  return {
    category,
    linkedCount: Number(linked?.count || 0),
    childCount: Number(child?.count || 0),
  };
};

const ensureCategoryDeletable = async (id) => {
  const guard = getCategoryDeleteGuard(await loadCategoryDeleteState(id));
  if (!guard.ok) throw appError(guard.error, guard.status);
  return guard.category;
};

const deleteCategoryRecord = async ({ req, id }) => {
  const before = await ensureCategoryDeletable(id);
  await run('DELETE FROM faq_categories WHERE id = ?', [id]);
  await logOperation({ req, action: 'CATEGORY_DELETE', message: `删除分类 ${before.name}`, beforeData: before });
  return before;
};

const forceDeleteCategoryRecord = async ({ req, id }) => {
  const before = await get('SELECT * FROM faq_categories WHERE id = ?', [id]);
  if (!before) throw appError('分类不存在', 404);

  const plan = collectCategoryForceDeletePlan(
    await query('SELECT id, parent_id FROM faq_categories'),
    id
  );
  if (!plan.category_ids.length) throw appError('分类不存在', 404);

  const categoryPlaceholders = plan.category_ids.map(() => '?').join(',');
  const linkedArticles = await query(
    `SELECT id, is_deleted
     FROM faq_articles
     WHERE category_id IN (${categoryPlaceholders})`,
    plan.category_ids
  );
  const linkedArticleIds = normalizeCategoryDeleteIds(linkedArticles.map((item) => item?.id));
  const activeArticleIds = normalizeCategoryDeleteIds(
    linkedArticles
      .filter((item) => Number(item?.is_deleted || 0) !== 1)
      .map((item) => item?.id)
  );
  const deletedArticleIds = normalizeCategoryDeleteIds(
    linkedArticles
      .filter((item) => Number(item?.is_deleted || 0) === 1)
      .map((item) => item?.id)
  );
  const retentionDays = normalizeRetentionDays(req.query.retention_days || req.body?.retention_days);
  const purgeAfter = formatDateTime(new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000));

  await transaction(async (tx) => {
    if (activeArticleIds.length) {
      const activePlaceholders = activeArticleIds.map(() => '?').join(',');
      await tx.run(
        `UPDATE faq_articles
         SET category_id = NULL,
             is_deleted = 1,
             deleted_at = NOW(),
             deleted_by_id = ?,
             deleted_by_name = ?,
             purge_after = ?,
             status = 'archived',
             updated_by_id = ?,
             updated_by_name = ?,
             updated_at = NOW()
         WHERE id IN (${activePlaceholders})`,
        [
          Number(req.user.id) || null,
          req.user.username,
          purgeAfter,
          Number(req.user.id) || null,
          req.user.username,
          ...activeArticleIds,
        ]
      );
    }

    if (deletedArticleIds.length) {
      const deletedPlaceholders = deletedArticleIds.map(() => '?').join(',');
      await tx.run(
        `UPDATE faq_articles
         SET category_id = NULL,
             updated_by_id = ?,
             updated_by_name = ?,
             updated_at = NOW()
         WHERE id IN (${deletedPlaceholders})`,
        [
          Number(req.user.id) || null,
          req.user.username,
          ...deletedArticleIds,
        ]
      );
    }

    if (linkedArticleIds.length) {
      const articlePlaceholders = linkedArticleIds.map(() => '?').join(',');
      await tx.run(
        `UPDATE faq_editor_sessions
         SET status = 'released', released_at = NOW(), updated_at = NOW()
         WHERE status = 'active' AND article_id IN (${articlePlaceholders})`,
        linkedArticleIds
      );
    }

    for (const categoryId of plan.delete_order) {
      await tx.run('DELETE FROM faq_categories WHERE id = ?', [categoryId]);
    }
  });

  const result = summarizeCategoryForceDeleteResults({
    deletedCategoryIds: plan.delete_order,
    recycledArticleIds: activeArticleIds,
  });

  await logOperation({
    req,
    action: 'CATEGORY_FORCE_DELETE',
    message: `强制删除分类 ${before.name}`,
    beforeData: {
      ...before,
      category_ids: plan.category_ids,
    },
    afterData: {
      ...result,
      retention_days: retentionDays,
      purge_after: purgeAfter,
      detached_deleted_article_ids: deletedArticleIds,
    },
  });

  return result;
};

const ensureArticleExists = async (articleId, options = {}) => {
  const includeDeleted = options?.includeDeleted === true;
  const article = await get(
    `SELECT *
     FROM faq_articles
     WHERE id = ?
       ${includeDeleted ? '' : 'AND is_deleted = 0'}
     LIMIT 1`,
    [articleId]
  );
  if (!article) throw appError(includeDeleted ? '文章不存在' : '文章不存在或已删除', 404);
  return article;
};

const getCurrentVersion = async (article) => {
  if (!Number.isFinite(Number(article?.current_version_id))) return null;
  return get('SELECT * FROM faq_article_versions WHERE id = ?', [Number(article.current_version_id)]);
};

const getNextVersionNo = async (tx, articleId) => {
  const row = await tx.get('SELECT MAX(version_no) AS max_no FROM faq_article_versions WHERE article_id = ?', [articleId]);
  return Number(row?.max_no || 0) + 1;
};

const getVersionById = async ({ articleId, versionId }) => {
  if (!Number.isFinite(Number(versionId)) || Number(versionId) <= 0) return null;
  return get(
    `SELECT *
     FROM faq_article_versions
     WHERE id = ? AND article_id = ?
     LIMIT 1`,
    [Number(versionId), Number(articleId)]
  );
};

const resolveVersionSearchText = async (version) => {
  if (!version) return '';
  const cached = normalizeSearchText(version.search_text, 240000);
  if (cached) return cached;

  const ext = `.${trimText(version.source_ext).toLowerCase()}`;
  let extracted = '';
  if (ext === '.docx') {
    extracted = await extractDocxSearchText(trimText(version.editable_file_path) || trimText(version.storage_path));
  } else if (ext === '.doc') {
    extracted = await extractDocxSearchText(trimText(version.editable_file_path));
  }

  const normalized = normalizeSearchText(extracted, 240000);
  if (normalized) {
    await run('UPDATE faq_article_versions SET search_text = ? WHERE id = ?', [normalized, Number(version.id)]);
  }
  return normalized;
};

const splitTextToDiffSegments = (value) => {
  const text = normalizeSearchText(value, 240000);
  if (!text) return [];
  const segments = text
    .replace(/\r\n/g, '\n')
    .replace(/([。！？.!?；;])/g, '$1\n')
    .split(/\n+/)
    .map((item) => trimText(item))
    .filter(Boolean);
  return segments.slice(0, DIFF_MAX_SEGMENTS);
};

const buildDiffEntries = (leftSegments, rightSegments) => {
  const leftCount = leftSegments.length;
  const rightCount = rightSegments.length;
  const dp = Array.from({ length: leftCount + 1 }, () => Array(rightCount + 1).fill(0));

  for (let i = leftCount - 1; i >= 0; i -= 1) {
    for (let j = rightCount - 1; j >= 0; j -= 1) {
      if (leftSegments[i] === rightSegments[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const entries = [];
  let i = 0;
  let j = 0;
  while (i < leftCount && j < rightCount) {
    if (leftSegments[i] === rightSegments[j]) {
      entries.push({ type: 'equal', text: leftSegments[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      entries.push({ type: 'remove', text: leftSegments[i] });
      i += 1;
    } else {
      entries.push({ type: 'add', text: rightSegments[j] });
      j += 1;
    }
  }
  while (i < leftCount) {
    entries.push({ type: 'remove', text: leftSegments[i] });
    i += 1;
  }
  while (j < rightCount) {
    entries.push({ type: 'add', text: rightSegments[j] });
    j += 1;
  }

  const merged = [];
  for (const item of entries) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === item.type) {
      prev.text = `${prev.text}\n${item.text}`;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
};

const buildVersionDiffResult = ({ leftText, rightText }) => {
  const leftSegments = splitTextToDiffSegments(leftText);
  const rightSegments = splitTextToDiffSegments(rightText);
  const diffEntries = buildDiffEntries(leftSegments, rightSegments);
  const limitedEntries = diffEntries.slice(0, DIFF_MAX_ENTRIES);
  const addCount = diffEntries.filter((item) => item.type === 'add').length;
  const removeCount = diffEntries.filter((item) => item.type === 'remove').length;
  const equalCount = diffEntries.filter((item) => item.type === 'equal').length;
  const denom = Math.max(1, addCount + removeCount + equalCount);
  const changeRatio = Math.min(1, (addCount + removeCount) / denom);

  return {
    left_segments: leftSegments.length,
    right_segments: rightSegments.length,
    diff_truncated: diffEntries.length > limitedEntries.length,
    summary: {
      add_blocks: addCount,
      remove_blocks: removeCount,
      equal_blocks: equalCount,
      change_ratio: Number(changeRatio.toFixed(4)),
    },
    entries: limitedEntries,
  };
};

const buildPublishPrecheck = async ({ article, version, operatorUserId }) => {
  const checks = [];

  checks.push({
    key: 'article_exists',
    label: '文章存在且未删除',
    ok: !!article && Number(article.is_deleted || 0) === 0,
    detail: article ? '' : '文章不存在',
    level: 'error',
  });

  checks.push({
    key: 'version_exists',
    label: '目标版本存在',
    ok: !!version,
    detail: version ? '' : '请选择要发布的版本',
    level: 'error',
  });

  if (article) {
    const title = trimText(article.title);
    checks.push({
      key: 'title_valid',
      label: '标题非空',
      ok: !!title,
      detail: title ? '' : '标题为空',
      level: 'error',
    });

    const hasCategory = Number(article.category_id || 0) > 0;
    checks.push({
      key: 'category_valid',
      label: '已选择分类',
      ok: hasCategory,
      detail: hasCategory ? '' : '未设置分类',
      level: 'error',
    });

    if (title) {
      const duplicate = await get(
        `SELECT id
         FROM faq_articles
         WHERE is_deleted = 0
           AND id <> ?
           AND LOWER(title) = LOWER(?)
         LIMIT 1`,
        [Number(article.id), title]
      );
      checks.push({
        key: 'duplicate_title',
        label: '标题唯一性',
        ok: !duplicate,
        detail: duplicate ? `存在同名FAQ(ID:${duplicate.id})` : '',
        level: 'warning',
      });
    }
  }

  if (version) {
    const renderStatus = trimText(version.render_status).toLowerCase() || 'ready';
    checks.push({
      key: 'render_status',
      label: '版本渲染状态正常',
      ok: renderStatus !== 'failed',
      detail: renderStatus === 'failed' ? trimText(version.render_error) || '渲染失败' : '',
      level: 'error',
    });

    const filePath = trimText(version.storage_path) || trimText(version.editable_file_path) || trimText(version.preview_file_path);
    const stat = await readFileStatSafe(filePath);
    checks.push({
      key: 'file_exists',
      label: '版本文件可访问',
      ok: !!stat?.isFile(),
      detail: stat?.isFile() ? '' : '发布版本文件不存在',
      level: 'error',
    });

    const contentText = await resolveVersionSearchText(version);
    checks.push({
      key: 'content_exists',
      label: '可提取正文',
      ok: contentText.length >= 20,
      detail: contentText.length >= 20 ? '' : '正文过短或不可提取，请检查文档内容',
      level: 'error',
    });

    const urls = extractUrlsFromText(contentText);
    const invalidUrls = validateHttpUrls(urls);
    checks.push({
      key: 'links_valid',
      label: '链接格式校验',
      ok: invalidUrls.length === 0,
      detail: invalidUrls.length ? `存在无效链接：${invalidUrls.slice(0, 3).join('，')}` : '',
      level: 'warning',
    });
  }

  await expireArticleSessions(Number(article?.id || 0));
  const activeSessions = Number(article?.id)
    ? await query(
        `SELECT lock_owner_id, lock_owner_name
         FROM faq_editor_sessions
         WHERE article_id = ?
           AND status = 'active'
           AND expires_at >= NOW()`,
        [Number(article.id)]
      )
    : [];
  const hasForeignLock = activeSessions.some((item) => Number(item.lock_owner_id || 0) !== Number(operatorUserId || 0));
  checks.push({
    key: 'editor_lock',
    label: '无他人编辑会话冲突',
    ok: !hasForeignLock,
    detail: hasForeignLock ? '仍有其他协作者在线编辑，请确认后再发布' : '',
    level: 'warning',
  });

  return {
    ok: checks.every((item) => item.level === 'warning' || item.ok),
    checks,
    active_lock: hasForeignLock ? activeSessions[0] : null,
  };
};

const publishArticleVersion = async ({ article, version, req, publishNote = '', action = 'ARTICLE_PUBLISH' }) => {
  const articleId = Number(article.id);
  const versionId = Number(version.id);
  const note = normalizePublishNote(publishNote);

  await transaction(async (tx) => {
    await tx.run('UPDATE faq_article_versions SET is_published_version = 0 WHERE article_id = ?', [articleId]);
    await tx.run(
      `UPDATE faq_article_versions
       SET is_published_version = 1,
           publish_note = ?
       WHERE id = ?`,
      [note || null, versionId]
    );
    await tx.run(
      `UPDATE faq_articles
       SET current_version_id = ?,
           published_version_id = ?,
           status = 'published',
           published_by_id = ?,
           published_by_name = ?,
           published_at = NOW(),
           updated_by_id = ?,
           updated_by_name = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        versionId,
        versionId,
        Number(req.user.id) || null,
        req.user.username,
        Number(req.user.id) || null,
        req.user.username,
        articleId,
      ]
    );
  });

  const afterArticle = await ensureArticleExists(articleId);
  const afterVersion = await getVersionById({ articleId, versionId });
  await logOperation({
    req,
    articleId,
    action,
    message: `发布版本 v${version.version_no}`,
    beforeData: {
      prev_published_version_id: Number(article.published_version_id) || null,
      prev_current_version_id: Number(article.current_version_id) || null,
    },
    afterData: {
      published_version_id: versionId,
      publish_note: note || null,
    },
  });
  return {
    article: afterArticle,
    version: afterVersion,
  };
};

const loadArticleDeleteBundle = async (articleId) => {
  const article = await get('SELECT * FROM faq_articles WHERE id = ? LIMIT 1', [articleId]);
  if (!article) return null;
  const versions = await query('SELECT * FROM faq_article_versions WHERE article_id = ?', [articleId]);
  const draft = await get('SELECT * FROM faq_article_drafts WHERE article_id = ?', [articleId]);

  const filesToCleanup = new Set();
  for (const version of versions) {
    const storagePath = trimText(version?.storage_path);
    const editablePath = trimText(version?.editable_file_path);
    const previewPath = trimText(version?.preview_file_path);
    if (storagePath) filesToCleanup.add(storagePath);
    if (editablePath) filesToCleanup.add(editablePath);
    if (previewPath) filesToCleanup.add(previewPath);
  }
  if (trimText(draft?.draft_file_path)) filesToCleanup.add(trimText(draft.draft_file_path));

  return {
    article,
    versions,
    draft,
    filesToCleanup: Array.from(filesToCleanup),
  };
};

const hardDeleteArticleById = async (articleId) => {
  const bundle = await loadArticleDeleteBundle(articleId);
  if (!bundle) return null;

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE faq_editor_sessions
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE article_id = ? AND status = 'active'`,
      [articleId]
    );
    await tx.run('DELETE FROM faq_article_drafts WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_editor_sessions WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_favorites WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_article_feedback WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_publish_requests WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_view_daily WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_view_events WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_article_versions WHERE article_id = ?', [articleId]);
    await tx.run('DELETE FROM faq_articles WHERE id = ?', [articleId]);
  });

  await Promise.all(bundle.filesToCleanup.map((filePath) => deleteFileSafe(filePath)));
  return bundle;
};

const expireArticleSessions = async (articleId) => {
  await run(
    `UPDATE faq_editor_sessions
     SET status = 'expired', updated_at = NOW()
     WHERE article_id = ? AND status = 'active' AND expires_at < NOW()`,
    [articleId]
  );
};

const getActiveSession = async (articleId) => {
  return get(
    `SELECT *
     FROM faq_editor_sessions
     WHERE article_id = ? AND status = 'active' AND expires_at >= NOW()
     ORDER BY id DESC
     LIMIT 1`,
    [articleId]
  );
};

const getOwnActiveSession = async (articleId, userId) => {
  return get(
    `SELECT *
     FROM faq_editor_sessions
     WHERE article_id = ?
       AND lock_owner_id = ?
       AND status = 'active'
       AND expires_at >= NOW()
     ORDER BY id DESC
     LIMIT 1`,
    [Number(articleId), Number(userId)]
  );
};

const listActiveSessions = async (articleId) => {
  return query(
    `SELECT id, lock_owner_id, lock_owner_name, expires_at, last_saved_at
     FROM faq_editor_sessions
     WHERE article_id = ?
       AND status = 'active'
       AND expires_at >= NOW()
     ORDER BY id DESC`,
    [Number(articleId)]
  );
};

const logArticlePurgedOperation = async ({ req = null, articleId, title = '', deletedAt = null, purgeAfter = null, manual = false } = {}) => {
  await logOperation({
    req,
    articleId: Number(articleId),
    action: 'ARTICLE_PURGE',
    message: `${manual ? '回收站手动清理' : '回收站自动清理'}「${trimText(title) || `ID:${articleId}`}」`,
    beforeData: {
      deleted_at: deletedAt,
      purge_after: purgeAfter,
      manual,
    },
  });
};

const emitArticlePurgedEvent = async ({ req = null, articleId, title = '', deletedAt = null, purgeAfter = null, manual = false } = {}) => {
  await emitSystemEvent({
    req,
    eventType: 'FAQ_RECYCLE_PURGED',
    articleId: Number(articleId),
    payload: {
      article_title: trimText(title),
      deleted_at: deletedAt,
      purge_after: purgeAfter,
      manual,
    },
  });
};

const purgeExpiredDeletedArticles = async () => {
  const expired = await query(
    `SELECT id, title, deleted_at, purge_after
     FROM faq_articles
     WHERE is_deleted = 1
       AND purge_after IS NOT NULL
       AND purge_after <= NOW()
     ORDER BY purge_after ASC
     LIMIT 100`
  );

  if (!expired.length) return 0;

  let purged = 0;
  for (const item of expired) {
    const removed = await hardDeleteArticleById(Number(item.id));
    if (!removed) continue;
    purged += 1;
    await logArticlePurgedOperation({
      articleId: Number(item.id),
      title: item.title,
      deletedAt: item.deleted_at,
      purgeAfter: item.purge_after,
      manual: false,
    });
    await emitArticlePurgedEvent({
      articleId: Number(item.id),
      title: item.title,
      deletedAt: item.deleted_at,
      purgeAfter: item.purge_after,
      manual: false,
    });
  }
  return purged;
};

const reindexMissingSearchText = async ({ limit = 200, articleId = null } = {}) => {
  const cappedLimit = Math.max(1, Math.min(1000, toPositiveInt(limit, 200)));
  const where = ["(v.search_text IS NULL OR v.search_text = '')", "LOWER(v.source_ext) IN ('doc', 'docx')"];
  const params = [];
  if (Number.isFinite(Number(articleId)) && Number(articleId) > 0) {
    where.push('v.article_id = ?');
    params.push(Number(articleId));
  }

  const rows = await query(
    `SELECT
      v.id,
      v.article_id,
      v.source_ext,
      v.storage_path,
      v.editable_file_path
     FROM faq_article_versions v
     JOIN faq_articles a ON a.id = v.article_id
     WHERE ${where.join(' AND ')}
       AND a.is_deleted = 0
     ORDER BY v.id ASC
     LIMIT ?`,
    [...params, cappedLimit]
  );

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const sourceExt = `.${trimText(row.source_ext).toLowerCase()}`;
    const searchText = await buildSearchTextByUpload({
      ext: sourceExt,
      uploadPath: trimText(row.storage_path),
      editablePath: trimText(row.editable_file_path),
    });
    const normalized = normalizeSearchText(searchText);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    await run('UPDATE faq_article_versions SET search_text = ? WHERE id = ?', [normalized, Number(row.id)]);
    updated += 1;
  }

  return {
    scanned: rows.length,
    updated,
    skipped,
  };
};

const normalizeSectionKey = (value) => trimText(value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);

const expireSectionLocks = async (articleId) => {
  await run(
    `UPDATE faq_editor_section_locks
     SET status = 'expired', updated_at = NOW()
     WHERE article_id = ? AND status = 'active' AND expires_at < NOW()`,
    [Number(articleId)]
  );
};

const getSectionLocks = async (articleId) => {
  await expireSectionLocks(articleId);
  const rows = await query(
    `SELECT section_key, section_name, lock_owner_id, lock_owner_name, status, expires_at, released_at, updated_at
     FROM faq_editor_section_locks
     WHERE article_id = ? AND status = 'active'
     ORDER BY section_key ASC`,
    [Number(articleId)]
  );
  const mapped = new Map(rows.map((item) => [trimText(item.section_key), item]));
  return DEFAULT_EDITOR_SECTIONS.map((section) => {
    const lock = mapped.get(section.key) || null;
    return {
      key: section.key,
      name: section.name,
      lock,
    };
  });
};

const acquireSectionLock = async ({ articleId, sectionKey, sectionName, req }) => {
  const key = normalizeSectionKey(sectionKey);
  if (!key) throw appError('分段键无效', 400);
  const normalizedName = trimText(sectionName || DEFAULT_EDITOR_SECTIONS.find((item) => item.key === key)?.name || key).slice(0, 128);
  const expiresAt = new Date(Date.now() + SECTION_LOCK_MINUTES * 60 * 1000);

  await expireSectionLocks(articleId);
  const active = await get(
    `SELECT *
     FROM faq_editor_section_locks
     WHERE article_id = ? AND section_key = ? AND status = 'active'
     LIMIT 1`,
    [Number(articleId), key]
  );
  if (active && Number(active.lock_owner_id) !== Number(req.user.id)) {
    throw appError(`分段「${normalizedName}」已由 ${trimText(active.lock_owner_name) || '其他用户'} 占用`, 409);
  }

  if (active) {
    await run(
      `UPDATE faq_editor_section_locks
       SET lock_owner_id = ?, lock_owner_name = ?, expires_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [Number(req.user.id) || 0, req.user.username, formatDateTime(expiresAt), Number(active.id)]
    );
  } else {
    await run(
      `INSERT INTO faq_editor_section_locks
       (article_id, section_key, section_name, lock_owner_id, lock_owner_name, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [Number(articleId), key, normalizedName, Number(req.user.id) || 0, req.user.username, formatDateTime(expiresAt)]
    );
  }
};

const releaseSectionLock = async ({ articleId, sectionKey, req }) => {
  const key = normalizeSectionKey(sectionKey);
  if (!key) throw appError('分段键无效', 400);
  const active = await get(
    `SELECT *
     FROM faq_editor_section_locks
     WHERE article_id = ? AND section_key = ? AND status = 'active'
     LIMIT 1`,
    [Number(articleId), key]
  );
  if (!active) return false;
  if (Number(active.lock_owner_id) !== Number(req.user.id) && !isAdmin(req)) {
    throw appError('仅锁持有者或管理员可释放分段锁', 403);
  }
  await run(
    `UPDATE faq_editor_section_locks
     SET status = 'released', released_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [Number(active.id)]
  );
  return true;
};

const extractSearchSnippet = (value, keyword) => {
  const text = normalizeSearchText(value, 1200);
  const key = trimText(keyword).toLowerCase();
  if (!text) return '';
  if (!key) return text.slice(0, 180);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(key);
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 36);
  const end = Math.min(text.length, idx + key.length + 96);
  return text.slice(start, end);
};

const extractUrlsFromText = (value) => {
  const text = normalizeSearchText(value, 240000);
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"'()]+/gi) || [];
  return Array.from(new Set(matches.map((item) => trimText(item)).filter(Boolean))).slice(0, 20);
};

const validateHttpUrls = (urls) => {
  const invalid = [];
  for (const item of urls || []) {
    try {
      // URL 构造用于校验格式，避免发布时写入明显非法链接
      const parsed = new URL(item);
      if (!['http:', 'https:'].includes(parsed.protocol)) invalid.push(item);
    } catch {
      invalid.push(item);
    }
  }
  return invalid;
};

const buildSearchSuggestions = async ({ keyword, currentArticleIds = [] }) => {
  const key = trimText(keyword);
  if (!key) return [];
  const prefix = `%${key.slice(0, 32)}%`;
  const rows = await query(
    `SELECT id, title, summary
     FROM faq_articles
     WHERE is_deleted = 0
       AND (title LIKE ? OR summary LIKE ? OR tags_json LIKE ?)
     ORDER BY is_pinned DESC, updated_at DESC
     LIMIT ?`,
    [prefix, prefix, prefix, SEARCH_SUGGESTION_LIMIT * 4]
  );
  const exists = new Set((currentArticleIds || []).map((item) => Number(item)));
  const selected = [];
  for (const item of rows) {
    const id = Number(item.id);
    if (!id || exists.has(id)) continue;
    selected.push({
      article_id: id,
      title: trimText(item.title),
      summary_snippet: extractSearchSnippet(item.summary, key),
    });
    if (selected.length >= SEARCH_SUGGESTION_LIMIT) break;
  }
  return selected;
};

const pushReminderWebhook = async (payload) => {
  if (!REMINDER_WEBHOOK_URL) return { skipped: true, reason: 'REMINDER_WEBHOOK_URL 未配置' };
  const headers = {
    'Content-Type': 'application/json',
  };
  if (REMINDER_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${REMINDER_WEBHOOK_TOKEN}`;
  }
  const resp = await fetchWithTimeout(
    REMINDER_WEBHOOK_URL,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    REMINDER_WEBHOOK_TIMEOUT_MS
  );
  if (!resp.ok) {
    const raw = await resp.text().catch(() => '');
    throw new Error(`提醒推送失败(${resp.status}) ${trimText(raw).slice(0, 200)}`);
  }
  return { ok: true };
};

const emitSystemEvent = async ({ eventType, articleId = null, req = null, payload = {} }) => {
  const targetPayload = {
    source_system: 'faq',
    event_type: trimText(eventType).slice(0, 64),
    article_id: Number.isFinite(Number(articleId)) ? Number(articleId) : null,
    operator_id: Number(req?.user?.id) || null,
    operator_name: trimText(req?.user?.username) || null,
    operator_role: trimText(req?.user?.role) || null,
    occurred_at: formatDateTime(new Date()),
    data: payload || {},
  };

  const insert = await run(
    `INSERT INTO faq_event_outbox
      (target_system, event_type, article_id, payload_json, delivery_status, delivery_attempts, next_retry_at)
     VALUES ('reminder', ?, ?, ?, 'pending', 0, NOW())`,
    [targetPayload.event_type, targetPayload.article_id, JSON.stringify(targetPayload)]
  );

  try {
    await pushReminderWebhook(targetPayload);
    await run(
      `UPDATE faq_event_outbox
       SET delivery_status = 'sent',
           delivery_attempts = delivery_attempts + 1,
           delivered_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [Number(insert.insertId)]
    );
  } catch (err) {
    await run(
      `UPDATE faq_event_outbox
       SET delivery_status = CASE WHEN delivery_status = 'pending' THEN 'failed' ELSE delivery_status END,
           delivery_attempts = delivery_attempts + 1,
           last_error = ?,
           next_retry_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE),
           updated_at = NOW()
       WHERE id = ?`,
      [trimText(err?.message).slice(0, 800), Number(insert.insertId)]
    );
  }
};

const flushPendingSystemEvents = async (limit = 20) => {
  const rows = await query(
    `SELECT id, payload_json
     FROM faq_event_outbox
     WHERE delivery_status IN ('pending', 'failed')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY id ASC
     LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 20))]
  );
  if (!rows.length) return { scanned: 0, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const item of rows) {
    let payload = null;
    try {
      payload = toJson(item.payload_json, null);
      if (!payload) throw new Error('payload empty');
      await pushReminderWebhook(payload);
      await run(
        `UPDATE faq_event_outbox
         SET delivery_status = 'sent',
             delivery_attempts = delivery_attempts + 1,
             delivered_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [Number(item.id)]
      );
      sent += 1;
    } catch (err) {
      await run(
        `UPDATE faq_event_outbox
         SET delivery_status = 'failed',
             delivery_attempts = delivery_attempts + 1,
             last_error = ?,
             next_retry_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE),
             updated_at = NOW()
         WHERE id = ?`,
        [trimText(err?.message).slice(0, 800), Number(item.id)]
      );
      failed += 1;
    }
  }
  return {
    scanned: rows.length,
    sent,
    failed,
  };
};

const buildSmartPinCandidates = async ({ limit = SMART_PIN_TOPN } = {}) => {
  const rows = await query(
    `SELECT
      a.id,
      a.title,
      a.is_pinned,
      a.updated_at,
      COALESCE(vs.views_7d, 0) AS views_7d,
      COALESCE(vs.views_30d, 0) AS views_30d,
      COALESCE(fb.total_feedback, 0) AS feedback_total,
      COALESCE(fb.solved_feedback, 0) AS solved_feedback,
      COALESCE(fb.unsolved_feedback, 0) AS unsolved_feedback
     FROM faq_articles a
     LEFT JOIN (
       SELECT
         article_id,
         SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS views_7d,
         SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS views_30d
       FROM faq_view_events
       GROUP BY article_id
     ) vs ON vs.article_id = a.id
     LEFT JOIN (
       SELECT
         article_id,
         COUNT(1) AS total_feedback,
         SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) AS solved_feedback,
         SUM(CASE WHEN solved = 0 THEN 1 ELSE 0 END) AS unsolved_feedback
       FROM faq_article_feedback
       GROUP BY article_id
     ) fb ON fb.article_id = a.id
     WHERE a.is_deleted = 0
       AND a.status = 'published'`
  );

  const scored = rows
    .map((item) => {
      const views7d = Number(item.views_7d || 0);
      const views30d = Number(item.views_30d || 0);
      const unsolved = Number(item.unsolved_feedback || 0);
      const solved = Number(item.solved_feedback || 0);
      const feedbackTotal = Number(item.feedback_total || 0);
      const solvedRate = feedbackTotal > 0 ? solved / feedbackTotal : 1;
      const freshness = Math.max(0, 30 - Math.floor((Date.now() - new Date(String(item.updated_at || '').replace(' ', 'T')).getTime()) / (24 * 3600 * 1000)));
      const score = views7d * 2 + views30d * 0.6 + unsolved * 4 + freshness * 0.5 + (1 - solvedRate) * 8;
      return {
        article_id: Number(item.id),
        title: trimText(item.title),
        current_pinned: Number(item.is_pinned || 0) === 1,
        views_7d: views7d,
        views_30d: views30d,
        unsolved_feedback: unsolved,
        solved_rate: Number(solvedRate.toFixed(4)),
        score: Number(score.toFixed(4)),
        reason: `近7天访问${views7d}次，未解决反馈${unsolved}条`,
      };
    })
    .sort((a, b) => b.score - a.score || b.views_7d - a.views_7d || b.unsolved_feedback - a.unsolved_feedback)
    .slice(0, Math.max(1, Math.min(20, Number(limit) || SMART_PIN_TOPN)));

  return scored;
};

const applySmartPins = async ({ req, top = SMART_PIN_TOPN } = {}) => {
  const candidates = await buildSmartPinCandidates({ limit: top });
  if (!candidates.length) return { applied: 0, candidates: [] };
  const picked = new Set(candidates.map((item) => Number(item.article_id)).filter((id) => id > 0));
  const allPublished = await query(`SELECT id FROM faq_articles WHERE is_deleted = 0 AND status = 'published'`);
  await transaction(async (tx) => {
    for (const row of allPublished) {
      const id = Number(row.id);
      if (!id) continue;
      const target = candidates.find((item) => item.article_id === id) || null;
      const nextPinned = picked.has(id) ? 1 : 0;
      await tx.run(
        `UPDATE faq_articles
         SET is_pinned = ?, pin_score = ?, pinned_reason = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          nextPinned,
          target ? target.score : 0,
          target ? target.reason : null,
          Number(req?.user?.id) || null,
          trimText(req?.user?.username) || 'system',
          id,
        ]
      );
    }
  });
  return {
    applied: picked.size,
    candidates,
  };
};

const buildOnlyOfficeConfig = ({ session, article, draft, editableUrl, callbackUrl }) => {
  const ext = '.docx';
  const config = {
    document: {
      fileType: 'docx',
      key: `faq-${article.id}-${Number(draft.id)}-${Math.floor(Date.now() / 1000)}`,
      title: `${trimText(article.title) || 'FAQ文档'}${ext}`,
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
        id: String(session.lock_owner_id),
        name: String(session.lock_owner_name),
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
    token: jwt.sign(config, DOC_EDITOR_JWT_SECRET, {
      expiresIn: '2h',
    }),
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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
    filename: (_req, file, cb) => {
      const ext = normalizeUploadExt(file.originalname || '') || path.extname(String(file.originalname || '')).toLowerCase();
      cb(null, buildStoredFilename(file.originalname, ext));
    },
  }),
  limits: {
    fileSize: FILE_MAX_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = normalizeUploadExt(file.originalname || '');
    const mime = trimText(file.mimetype).toLowerCase();
    if (!ext || (!ALLOWED_UPLOAD_MIME.has(mime) && mime)) {
      return cb(appError('仅支持 doc/docx/pdf 文件', 400));
    }
    return cb(null, true);
  },
});

const uploadSingle = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(appError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, 400));
    }
    return next(appError(err.message || '文件上传失败', err.statusCode || 400));
  });
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'faq-api' });
});

const handleDraftDownload = async (req, res) => {
  const reqMeta = {
    path: req.originalUrl,
    ua: trimText(req.headers['user-agent']).slice(0, 180),
    xff: trimText(req.headers['x-forwarded-for']).slice(0, 120),
  };
  const accessToken = trimText(req.query.token) || trimText(req.params.accessToken);
  const payload = verifyDraftAccessToken(accessToken);
  if (payload?.type !== 'faq_draft') throw appError('访问令牌类型无效', 401);

  const draftId = Number(req.params.id);
  if (!Number.isFinite(draftId) || draftId <= 0) throw appError('draft id 无效', 400);
  if (Number(payload?.draftId) !== draftId) throw appError('访问令牌与草稿不匹配', 401);

  const session = await get('SELECT * FROM faq_editor_sessions WHERE session_key = ? LIMIT 1', [trimText(payload.sessionKey)]);
  if (!session || session.status !== 'active' || parseDate(session.expires_at)?.getTime() < Date.now()) {
    throw appError('编辑会话已失效', 410);
  }
  if (Number(session.draft_id) !== draftId) throw appError('编辑会话与草稿不匹配', 401);

  const draft = await get('SELECT * FROM faq_article_drafts WHERE id = ? LIMIT 1', [draftId]);
  if (!draft) throw appError('草稿不存在', 404);
  const stat = await readFileStatSafe(draft.draft_file_path);
  if (!stat || !stat.isFile()) throw appError('草稿文件不存在', 404);

  debugDocEditor('draft_download_ready', {
    ...reqMeta,
    draft_id: draftId,
    session_key: trimText(payload.sessionKey).slice(0, 32),
    status: session.status,
    expires_at: session.expires_at,
    file_path: draft.draft_file_path,
    file_size: Number(stat.size || 0),
  });

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', guessMimeByExt('.docx'));
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(draft.draft_file_name || `faq-draft-${draft.id}.docx`)}`
  );
  res.sendFile(draft.draft_file_path, (err) => {
    if (err) {
      debugDocEditor('draft_download_send_error', {
        ...reqMeta,
        draft_id: draftId,
        error: trimText(err.message).slice(0, 240),
      });
      return;
    }
    debugDocEditor('draft_download_sent', {
      ...reqMeta,
      draft_id: draftId,
      http_status: res.statusCode,
      content_length: Number(stat.size || 0),
    });
  });
};

app.get('/api/faq/drafts/:id/download.docx', asyncHandler(handleDraftDownload));
app.get('/api/faq/drafts/:id/download/:accessToken?', asyncHandler(handleDraftDownload));

app.post(
  '/api/faq/editor/callback/:sessionKey',
  asyncHandler(async (req, res) => {
    const sessionKey = trimText(req.params.sessionKey);
    if (!sessionKey) throw appError('会话ID无效', 400);

    const session = await get('SELECT * FROM faq_editor_sessions WHERE session_key = ? LIMIT 1', [sessionKey]);
    if (!session) throw appError('会话不存在', 404);

    const callbackToken = trimText(req.query.token);
    if (!callbackToken || callbackToken !== trimText(session.callback_token)) {
      throw appError('回调鉴权失败', 401);
    }

    const status = Number(req.body?.status || 0);
    const fileUrl = trimText(req.body?.url);

    if ([2, 6].includes(status) && fileUrl) {
      const draft = await get('SELECT * FROM faq_article_drafts WHERE id = ? LIMIT 1', [session.draft_id]);
      if (!draft) throw appError('草稿不存在', 404);

      const buf = await downloadDocEditorFile(fileUrl, 15000);

      await fs.promises.writeFile(draft.draft_file_path, buf);
      await run(
        `UPDATE faq_article_drafts
         SET updated_at = NOW(), updated_by_id = ?, updated_by_name = ?
         WHERE id = ?`,
        [Number(session.lock_owner_id) || null, trimText(session.lock_owner_name) || null, Number(draft.id)]
      );
      await run('UPDATE faq_editor_sessions SET last_saved_at = NOW(), updated_at = NOW() WHERE id = ?', [Number(session.id)]);
    }

    return res.json({ error: 0 });
  })
);

app.use('/api', authRequired);

app.get('/api/auth/me', asyncHandler(async (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    apps: req.authApps,
    scope: req.user.scope || { department: null, managedDepartments: [] },
    permissions: {
      can_write_faq: canWriteFaq(req),
      can_review_publish: canReviewPublish(req),
      can_view_audit: isAuditor(req),
      can_manage_global_library: canManageGlobalLibrary(req),
      managed_department_codes: getRequestManagedDepartments(req),
    },
  });
}));

app.get('/api/faq/categories', asyncHandler(async (req, res) => {
  const visibility = buildCategoryVisibilityWhere(req, true);
  const rows = await query(
    `SELECT id, name, parent_id, library_scope, department_code, sort_order, is_active, created_by_id, created_by_name, created_at, updated_at
     FROM faq_categories
     WHERE ${visibility.clause}
     ORDER BY library_scope ASC, sort_order ASC, id ASC`,
    visibility.params
  );
  res.json(rows);
}));

app.post('/api/faq/categories', asyncHandler(async (req, res) => {
  const name = trimText(req.body?.name);
  if (!name) throw appError('分类名称不能为空', 400);
  const parentId = Number(req.body?.parent_id);
  const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;
  const isActive = req.body?.is_active === 0 || req.body?.is_active === false ? 0 : 1;
  const libraryScope = normalizeLibraryScope(req.body?.library_scope);
  const departmentCode = normalizeDepartmentCode(req.body?.department_code || getRequestDepartmentCode(req));
  if (libraryScope === 'global') {
    if (!canManageGlobalLibrary(req)) throw appError('仅管理员可维护全局库分类', 403);
  } else if (!canManageDepartmentLibrary(req, departmentCode)) {
    throw appError('仅部门文档管理员可维护本部门分类', 403);
  }
  const parentValue = Number.isFinite(parentId) && parentId > 0 ? parentId : null;
  if (parentValue) {
    await ensureCategoryMatchesLibrary({ categoryId: parentValue, libraryScope, departmentCode });
  }

  const result = await run(
    `INSERT INTO faq_categories (name, parent_id, library_scope, department_code, sort_order, is_active, created_by_id, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      parentValue,
      libraryScope,
      libraryScope === 'global' ? null : departmentCode,
      sortOrder,
      isActive,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );

  const row = await get('SELECT * FROM faq_categories WHERE id = ?', [result.insertId]);
  await logOperation({ req, action: 'CATEGORY_CREATE', message: `创建分类 ${name}`, afterData: row });
  res.status(201).json(row);
}));

app.put('/api/faq/categories/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('分类ID无效', 400);
  const before = await get('SELECT * FROM faq_categories WHERE id = ?', [id]);
  if (!before) throw appError('分类不存在', 404);
  const beforeScope = normalizeLibraryScope(before.library_scope);
  const beforeDepartmentCode = normalizeDepartmentCode(before.department_code);
  if (beforeScope === 'global') {
    if (!canManageGlobalLibrary(req)) throw appError('仅管理员可维护全局库分类', 403);
  } else if (!canManageDepartmentLibrary(req, beforeDepartmentCode)) {
    throw appError('仅部门文档管理员可维护本部门分类', 403);
  }

  const name = trimText(req.body?.name) || before.name;
  const parentId = Number(req.body?.parent_id);
  const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : Number(before.sort_order || 0);
  const isActive = req.body?.is_active === undefined ? Number(before.is_active || 0) : req.body?.is_active ? 1 : 0;
  const nextScope = isAdmin(req)
    ? normalizeLibraryScope(req.body?.library_scope || beforeScope)
    : beforeScope;
  const nextDepartmentCode = nextScope === 'global'
    ? null
    : normalizeDepartmentCode(req.body?.department_code || beforeDepartmentCode || getRequestDepartmentCode(req));
  const parentValue = Number.isFinite(parentId) && parentId > 0 ? parentId : null;
  if (parentValue) {
    await ensureCategoryMatchesLibrary({ categoryId: parentValue, libraryScope: nextScope, departmentCode: nextDepartmentCode });
  }

  await run(
    `UPDATE faq_categories
     SET name = ?, parent_id = ?, library_scope = ?, department_code = ?, sort_order = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [name, parentValue, nextScope, nextDepartmentCode, sortOrder, isActive, id]
  );

  const after = await get('SELECT * FROM faq_categories WHERE id = ?', [id]);
  await logOperation({ req, action: 'CATEGORY_UPDATE', articleId: null, message: `更新分类 ${name}`, beforeData: before, afterData: after });
  res.json(after);
}));

app.post('/api/faq/categories/batch-delete', asyncHandler(async (req, res) => {
  const ids = normalizeCategoryDeleteIds(req.body?.ids);
  if (!ids.length) throw appError('请选择要删除的分类', 400);
  const categoryRows = ids.length > 1
    ? await query(`SELECT id, parent_id FROM faq_categories WHERE id IN (${buildInClause(ids)})`, ids)
    : [];
  const orderedIds = ids.length > 1 ? orderCategoryBatchDeleteIds(categoryRows, ids) : ids;

  const results = [];
  for (const id of orderedIds) {
    try {
      const before = await get('SELECT * FROM faq_categories WHERE id = ?', [id]);
      if (!before) throw appError('分类不存在', 404);
      const scope = normalizeLibraryScope(before.library_scope);
      if (scope === 'global') {
        if (!canManageGlobalLibrary(req)) throw appError('仅管理员可删除全局库分类', 403);
      } else if (!canManageDepartmentLibrary(req, before.department_code)) {
        throw appError('仅部门文档管理员可删除本部门分类', 403);
      }
      await deleteCategoryRecord({ req, id });
      results.push({ id, ok: true });
    } catch (err) {
      if (err?.statusCode) {
        results.push({
          id,
          ok: false,
          error: trimText(err.message, '删除失败'),
        });
        continue;
      }
      throw err;
    }
  }

  res.json(summarizeCategoryBatchDeleteResults(results));
}));

app.post('/api/faq/categories/:id/force-delete', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('分类ID无效', 400);
  const result = await forceDeleteCategoryRecord({ req, id });
  res.json(result);
}));

app.delete('/api/faq/categories/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('分类ID无效', 400);
  const before = await get('SELECT * FROM faq_categories WHERE id = ?', [id]);
  if (!before) throw appError('分类不存在', 404);
  const scope = normalizeLibraryScope(before.library_scope);
  if (scope === 'global') {
    if (!canManageGlobalLibrary(req)) throw appError('仅管理员可删除全局库分类', 403);
  } else if (!canManageDepartmentLibrary(req, before.department_code)) {
    throw appError('仅部门文档管理员可删除本部门分类', 403);
  }
  await deleteCategoryRecord({ req, id });
  res.json({ ok: true });
}));

app.use(['/api/faq/templates', '/api/faq/snippets'], (req, res) => {
  res.status(404).json({ error: '知识资产功能已下线' });
});

app.get('/api/faq/templates', asyncHandler(async (req, res) => {
  const activeOnly = req.query.active === '1';
  const rows = await query(
    `SELECT *
     FROM faq_templates
     ${activeOnly ? 'WHERE is_active = 1' : ''}
     ORDER BY updated_at DESC, id DESC
     LIMIT 300`
  );
  res.json(rows.map((item) => ({
    ...item,
    tags: toJson(item.tags_json, []),
  })));
}));

app.post('/api/faq/templates', requireWriter, asyncHandler(async (req, res) => {
  const name = trimText(req.body?.name).slice(0, 128);
  if (!name) throw appError('模板名称不能为空', 400);
  const description = trimText(req.body?.description).slice(0, 255) || null;
  const titleTemplate = trimText(req.body?.title_template).slice(0, 255) || null;
  const summaryTemplate = trimText(req.body?.summary_template) || null;
  const bodyTemplate = trimText(req.body?.body_template) || null;
  const categoryId = Number(req.body?.category_id);
  const tags = parseTags(req.body?.tags);
  const isActive = req.body?.is_active === 0 || req.body?.is_active === false ? 0 : 1;

  const insert = await run(
    `INSERT INTO faq_templates
      (name, description, title_template, summary_template, body_template, category_id, tags_json, is_active, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      description,
      titleTemplate,
      summaryTemplate,
      bodyTemplate,
      Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null,
      JSON.stringify(tags),
      isActive,
      Number(req.user.id) || null,
      req.user.username,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );
  const row = await get('SELECT * FROM faq_templates WHERE id = ?', [insert.insertId]);
  await logOperation({
    req,
    action: 'TEMPLATE_CREATE',
    message: `创建模板 ${name}`,
    afterData: row,
  });
  res.status(201).json({ ...row, tags });
}));

app.put('/api/faq/templates/:id', requireWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模板ID无效', 400);
  const before = await get('SELECT * FROM faq_templates WHERE id = ?', [id]);
  if (!before) throw appError('模板不存在', 404);

  const nextName = trimText(req.body?.name).slice(0, 128) || before.name;
  const nextDescription = req.body?.description === undefined ? before.description : trimText(req.body.description).slice(0, 255) || null;
  const nextTitleTemplate = req.body?.title_template === undefined ? before.title_template : trimText(req.body.title_template).slice(0, 255) || null;
  const nextSummaryTemplate = req.body?.summary_template === undefined ? before.summary_template : trimText(req.body.summary_template) || null;
  const nextBodyTemplate = req.body?.body_template === undefined ? before.body_template : trimText(req.body.body_template) || null;
  const categoryId = Number(req.body?.category_id);
  const nextTags = req.body?.tags === undefined ? toJson(before.tags_json, []) : parseTags(req.body.tags);
  const nextIsActive = req.body?.is_active === undefined ? Number(before.is_active || 0) : (req.body?.is_active ? 1 : 0);

  await run(
    `UPDATE faq_templates
     SET name = ?, description = ?, title_template = ?, summary_template = ?, body_template = ?,
         category_id = ?, tags_json = ?, is_active = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      nextName,
      nextDescription,
      nextTitleTemplate,
      nextSummaryTemplate,
      nextBodyTemplate,
      Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null,
      JSON.stringify(nextTags),
      nextIsActive,
      Number(req.user.id) || null,
      req.user.username,
      id,
    ]
  );
  const after = await get('SELECT * FROM faq_templates WHERE id = ?', [id]);
  await logOperation({
    req,
    action: 'TEMPLATE_UPDATE',
    message: `更新模板 ${nextName}`,
    beforeData: before,
    afterData: after,
  });
  res.json({ ...after, tags: nextTags });
}));

app.delete('/api/faq/templates/:id', requireWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模板ID无效', 400);
  const before = await get('SELECT * FROM faq_templates WHERE id = ?', [id]);
  if (!before) throw appError('模板不存在', 404);
  await run('DELETE FROM faq_templates WHERE id = ?', [id]);
  await logOperation({
    req,
    action: 'TEMPLATE_DELETE',
    message: `删除模板 ${before.name}`,
    beforeData: before,
  });
  res.json({ ok: true });
}));

app.get('/api/faq/snippets', asyncHandler(async (req, res) => {
  const activeOnly = req.query.active === '1';
  const rows = await query(
    `SELECT *
     FROM faq_snippets
     ${activeOnly ? 'WHERE is_active = 1' : ''}
     ORDER BY usage_count DESC, updated_at DESC, id DESC
     LIMIT 300`
  );
  res.json(rows.map((item) => ({
    ...item,
    tags: toJson(item.tags_json, []),
  })));
}));

app.post('/api/faq/snippets', requireWriter, asyncHandler(async (req, res) => {
  const name = trimText(req.body?.name).slice(0, 128);
  const content = trimText(req.body?.content);
  if (!name) throw appError('片段名称不能为空', 400);
  if (!content) throw appError('片段内容不能为空', 400);
  const tags = parseTags(req.body?.tags);
  const isActive = req.body?.is_active === 0 || req.body?.is_active === false ? 0 : 1;
  const insert = await run(
    `INSERT INTO faq_snippets
      (name, content, tags_json, is_active, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      content,
      JSON.stringify(tags),
      isActive,
      Number(req.user.id) || null,
      req.user.username,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );
  const row = await get('SELECT * FROM faq_snippets WHERE id = ?', [insert.insertId]);
  await logOperation({
    req,
    action: 'SNIPPET_CREATE',
    message: `创建片段 ${name}`,
    afterData: row,
  });
  res.status(201).json({ ...row, tags });
}));

app.put('/api/faq/snippets/:id', requireWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('片段ID无效', 400);
  const before = await get('SELECT * FROM faq_snippets WHERE id = ?', [id]);
  if (!before) throw appError('片段不存在', 404);

  const nextName = trimText(req.body?.name).slice(0, 128) || before.name;
  const nextContent = req.body?.content === undefined ? before.content : trimText(req.body.content) || before.content;
  const nextTags = req.body?.tags === undefined ? toJson(before.tags_json, []) : parseTags(req.body.tags);
  const nextIsActive = req.body?.is_active === undefined ? Number(before.is_active || 0) : (req.body?.is_active ? 1 : 0);
  await run(
    `UPDATE faq_snippets
     SET name = ?, content = ?, tags_json = ?, is_active = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      nextName,
      nextContent,
      JSON.stringify(nextTags),
      nextIsActive,
      Number(req.user.id) || null,
      req.user.username,
      id,
    ]
  );
  const after = await get('SELECT * FROM faq_snippets WHERE id = ?', [id]);
  await logOperation({
    req,
    action: 'SNIPPET_UPDATE',
    message: `更新片段 ${nextName}`,
    beforeData: before,
    afterData: after,
  });
  res.json({ ...after, tags: nextTags });
}));

app.delete('/api/faq/snippets/:id', requireWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('片段ID无效', 400);
  const before = await get('SELECT * FROM faq_snippets WHERE id = ?', [id]);
  if (!before) throw appError('片段不存在', 404);
  await run('DELETE FROM faq_snippets WHERE id = ?', [id]);
  await logOperation({
    req,
    action: 'SNIPPET_DELETE',
    message: `删除片段 ${before.name}`,
    beforeData: before,
  });
  res.json({ ok: true });
}));

app.post('/api/faq/snippets/:id/use', requireWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('片段ID无效', 400);
  const row = await get('SELECT * FROM faq_snippets WHERE id = ?', [id]);
  if (!row) throw appError('片段不存在', 404);
  await run(
    `UPDATE faq_snippets
     SET usage_count = usage_count + 1, updated_at = NOW()
     WHERE id = ?`,
    [id]
  );
  const after = await get('SELECT * FROM faq_snippets WHERE id = ?', [id]);
  res.json({ ok: true, snippet: { ...after, tags: toJson(after.tags_json, []) } });
}));

app.get('/api/faq/articles', asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 20);
  const offset = (page - 1) * limit;
  const recycleMode = req.query.recycle === '1';

  const where = [];
  const params = [];

  where.push(recycleMode ? 'a.is_deleted = 1' : 'a.is_deleted = 0');

  const categoryId = Number(req.query.category_id);
  if (Number.isFinite(categoryId) && categoryId > 0) {
    where.push('a.category_id = ?');
    params.push(categoryId);
  }

  const status = trimText(req.query.status).toLowerCase();
  if (status) {
    where.push('a.status = ?');
    params.push(normalizeStatus(status));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = recycleMode
    ? 'a.deleted_at DESC, a.updated_at DESC, a.id DESC'
    : 'a.is_pinned DESC, a.updated_at DESC, a.id DESC';

  const rows = await query(
    `SELECT
      a.*,
      c.name AS category_name,
      cv.search_text AS matched_search_text,
      cv.version_no AS current_version_no,
      cv.render_type AS current_render_type,
      cv.render_status AS current_render_status,
      pv.version_no AS published_version_no,
      (SELECT COUNT(1) FROM faq_favorites f WHERE f.article_id = a.id) AS favorite_count,
      (SELECT COUNT(1) FROM faq_view_events v WHERE v.article_id = a.id) AS view_count
     FROM faq_articles a
     LEFT JOIN faq_categories c ON c.id = a.category_id
     LEFT JOIN faq_article_versions cv ON cv.id = a.current_version_id
     LEFT JOIN faq_article_versions pv ON pv.id = a.published_version_id
     ${whereSql}
     ORDER BY ${orderSql}`,
    params
  );

  const keyword = trimText(req.query.keyword);
  const libraryFilter = trimText(req.query.library_scope).toLowerCase();
  const grantMap = await getGrantMapForArticles({
    articleIds: rows.map((item) => Number(item.id || 0)),
    userId: Number(req.user.id) || 0,
  });

  const filtered = rows
    .map((item) => {
      const access = resolveArticleAccess({
        user: req.user,
        article: item,
        activeGrant: grantMap.get(Number(item.id)),
      });
      const visibleItem = sanitizeArticleForList({
        ...item,
        favorite_count: Number(item.favorite_count || 0),
        view_count: Number(item.view_count || 0),
        match_snippet: keyword
          ? extractSearchSnippet(item.summary || item.matched_search_text || item.title, keyword)
          : '',
      }, access);
      return {
        ...visibleItem,
        _access: access,
      };
    })
    .filter((item) => articleMatchesKeyword({ article: item, keyword, access: item._access }))
    .filter((item) => {
      if (libraryFilter === 'global') return String(item.library_scope || 'department').toLowerCase() === 'global';
      if (libraryFilter === 'department') {
        return String(item.library_scope || 'department').toLowerCase() === 'department' && item._access.visibility === 'full';
      }
      if (libraryFilter === 'restricted') return item._access.visibility === 'restricted';
      return true;
    });

  const paged = filtered.slice(offset, offset + limit).map((item) => ({
    ...item,
    visibility: item._access.visibility,
    _access: undefined,
  }));

  res.setHeader('X-Total-Count', String(filtered.length));
  res.setHeader('X-Page', String(page));
  res.setHeader('X-Limit', String(limit));

  res.json({
    items: paged,
    total: filtered.length,
    page,
    limit,
    keyword,
    suggestions: [],
  });
}));

app.post('/api/faq/articles', asyncHandler(async (req, res) => {
  const title = trimText(req.body?.title);
  if (!title) throw appError('标题不能为空', 400);

  const summary = trimText(req.body?.summary) || null;
  const categoryId = Number(req.body?.category_id);
  const tags = parseTags(req.body?.tags);
  const scopePayload = normalizeArticleScopeInput(req, req.body, getRequestDepartmentCode(req));
  if (scopePayload.library_scope === 'global') {
    if (!canManageGlobalLibrary(req)) throw appError('仅管理员可创建全局库文档', 403);
  } else if (!canManageDepartmentLibrary(req, scopePayload.department_code)) {
    throw appError('仅管理员、编辑或部门文档管理员可创建本部门文档', 403);
  }
  const categoryValue = Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null;
  if (categoryValue) {
    await ensureCategoryMatchesLibrary({
      categoryId: categoryValue,
      libraryScope: scopePayload.library_scope,
      departmentCode: scopePayload.department_code,
    });
  }

  const result = await run(
    `INSERT INTO faq_articles
      (title, summary, category_id, library_scope, department_code, tags_json, status, is_pinned, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?)`,
    [
      title,
      summary,
      categoryValue,
      scopePayload.library_scope,
      scopePayload.department_code,
      JSON.stringify(tags),
      Number(req.user.id) || null,
      req.user.username,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );

  const article = await get('SELECT * FROM faq_articles WHERE id = ?', [result.insertId]);
  await logOperation({ req, articleId: article.id, action: 'ARTICLE_CREATE', message: `创建FAQ「${title}」`, afterData: article });
  res.status(201).json({ ...article, tags });
}));

app.get('/api/faq/articles/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('文章ID无效', 400);

  const { article, access } = await ensureReadableArticle(req, id);

  const currentVersion = Number(article.current_version_id)
    ? await get('SELECT * FROM faq_article_versions WHERE id = ?', [Number(article.current_version_id)])
    : null;

  const publishedVersion = Number(article.published_version_id)
    ? await get('SELECT * FROM faq_article_versions WHERE id = ?', [Number(article.published_version_id)])
    : null;

  const draft = await get('SELECT * FROM faq_article_drafts WHERE article_id = ?', [id]);
  await expireArticleSessions(id);
  const activeSession = await getActiveSession(id);
  const myFeedback = await get(
    `SELECT id, solved, reason_code, reason_text, version_id, created_at, updated_at
     FROM faq_article_feedback
     WHERE article_id = ? AND user_id = ?
     LIMIT 1`,
    [id, Number(req.user.id) || 0]
  );
  const feedbackSummaryRow = await get(
    `SELECT
      COUNT(1) AS total,
      SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) AS solved_total,
      SUM(CASE WHEN solved = 0 THEN 1 ELSE 0 END) AS unsolved_total
     FROM faq_article_feedback
     WHERE article_id = ?`,
    [id]
  );
  const reasonRows = await query(
    `SELECT reason_code, COUNT(1) AS total
     FROM faq_article_feedback
     WHERE article_id = ?
       AND solved = 0
       AND reason_code IS NOT NULL
       AND reason_code <> ''
     GROUP BY reason_code
     ORDER BY total DESC
     LIMIT 5`,
    [id]
  );
  const requestRows = await query(
    `SELECT id, target_version_id, publish_note, status, requester_id, requester_name, reviewer_name, review_comment, reviewed_at, created_at
     FROM faq_publish_requests
     WHERE article_id = ?
       ${canReviewPublish(req) ? '' : 'AND requester_id = ?'}
     ORDER BY id DESC
     LIMIT 8`,
    canReviewPublish(req) ? [id] : [id, Number(req.user.id) || 0]
  );

  res.json({
    ...article,
    tags: toJson(article.tags_json, []),
    current_version: currentVersion,
    published_version: publishedVersion,
    draft,
    active_session: activeSession,
    feedback_summary: {
      total: Number(feedbackSummaryRow?.total || 0),
      solved_total: Number(feedbackSummaryRow?.solved_total || 0),
      unsolved_total: Number(feedbackSummaryRow?.unsolved_total || 0),
      solved_rate:
        Number(feedbackSummaryRow?.total || 0) > 0
          ? Number((Number(feedbackSummaryRow?.solved_total || 0) / Number(feedbackSummaryRow?.total || 1)).toFixed(4))
          : 0,
      reasons: reasonRows.map((item) => ({
        reason_code: trimText(item.reason_code),
        reason_label: FEEDBACK_REASON_LABELS[trimText(item.reason_code)] || trimText(item.reason_code) || '其他',
        total: Number(item.total || 0),
      })),
      my_feedback: myFeedback
        ? {
            ...myFeedback,
            solved: Number(myFeedback.solved || 0) === 1,
          }
        : null,
    },
    publish_requests: requestRows,
    library_access: access,
  });
}));

app.post('/api/faq/articles/:id/access-requests', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  const article = await getArticleWithCategory(articleId);
  if (!article) throw appError('文章不存在', 404);
  const access = await resolveArticleAccessForRequest(req, article);
  if (normalizeLibraryScope(article.library_scope) !== 'department') {
    throw appError('全局库文档无需申请权限', 400);
  }
  if (access.canRead) throw appError('当前账号已可查看该文档', 400);
  if (access.visibility !== 'restricted') throw appError('当前账号无权申请该文档', 403);

  const requestReason = trimText(req.body?.reason).slice(0, 500) || null;
  const insert = await run(
    `INSERT INTO faq_article_access_requests
      (article_id, requester_id, requester_name, requester_department_code, target_department_code, status, request_reason)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      articleId,
      Number(req.user.id) || 0,
      req.user.username,
      getRequestDepartmentCode(req) || null,
      normalizeDepartmentCode(article.department_code),
      requestReason,
    ]
  );
  const requestRow = await get('SELECT * FROM faq_article_access_requests WHERE id = ?', [insert.insertId]);
  await emitSystemEvent({
    eventType: 'FAQ_ACCESS_REQUEST_CREATED',
    articleId,
    req,
    payload: buildAccessRequestNoticePayload({ type: 'request_created', article, requestRow }),
  });
  res.status(201).json(requestRow);
}));

app.get('/api/faq/access-requests', asyncHandler(async (req, res) => {
  const mine = await query(
    `SELECT r.*, a.title AS article_title
     FROM faq_article_access_requests r
     JOIN faq_articles a ON a.id = r.article_id
     WHERE r.requester_id = ?
     ORDER BY r.id DESC
     LIMIT 100`,
    [Number(req.user.id) || 0]
  );
  let incoming = [];
  if (isAdmin(req) || getRequestManagedDepartments(req).length) {
    const departments = getRequestManagedDepartments(req);
    const where = isAdmin(req)
      ? '1=1'
      : `r.target_department_code IN (${buildInClause(departments)})`;
    incoming = await query(
      `SELECT r.*, a.title AS article_title
       FROM faq_article_access_requests r
       JOIN faq_articles a ON a.id = r.article_id
       WHERE ${where}
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC
       LIMIT 200`,
      isAdmin(req) ? [] : departments
    );
  }
  res.json({ mine, incoming });
}));

app.post('/api/faq/access-requests/:id/review', asyncHandler(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) throw appError('申请ID无效', 400);
  const requestRow = await get('SELECT * FROM faq_article_access_requests WHERE id = ?', [requestId]);
  if (!requestRow) throw appError('申请不存在', 404);
  if (!canReviewDepartmentRequest(req.user, requestRow.target_department_code)) {
    throw appError('仅目标部门文档管理员可审批', 403);
  }
  if (trimText(requestRow.status).toLowerCase() !== 'pending') throw appError('该申请已处理', 400);

  const decision = trimText(req.body?.status).toLowerCase();
  const nextStatus = decision === 'approved' ? 'approved' : (decision === 'rejected' ? 'rejected' : '');
  if (!nextStatus) throw appError('审批状态无效', 400);
  const reviewComment = trimText(req.body?.review_comment).slice(0, 500) || null;
  const article = await getArticleWithCategory(Number(requestRow.article_id));
  let grant = null;

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE faq_article_access_requests
       SET status = ?, review_comment = ?, reviewed_by_id = ?, reviewed_by_name = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [nextStatus, reviewComment, Number(req.user.id) || 0, req.user.username, requestId]
    );
    if (nextStatus === 'approved') {
      const durationCode = normalizeAccessDurationCode(req.body?.duration_code);
      const expiresAt = buildGrantExpiresAt(durationCode);
      await tx.run(
        `UPDATE faq_article_access_grants
         SET status = 'revoked', revoked_by_id = ?, revoked_by_name = ?, revoked_at = NOW(), updated_at = NOW()
         WHERE article_id = ? AND grantee_id = ? AND status = 'approved'`,
        [Number(req.user.id) || 0, req.user.username, Number(requestRow.article_id), Number(requestRow.requester_id)]
      );
      const insert = await tx.run(
        `INSERT INTO faq_article_access_grants
          (article_id, request_id, grantee_id, grantee_name, target_department_code, status, duration_code, expires_at, approved_by_id, approved_by_name, approved_at)
         VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, NOW())`,
        [
          Number(requestRow.article_id),
          requestId,
          Number(requestRow.requester_id),
          requestRow.requester_name,
          requestRow.target_department_code,
          durationCode,
          expiresAt,
          Number(req.user.id) || 0,
          req.user.username,
        ]
      );
      grant = await tx.get('SELECT * FROM faq_article_access_grants WHERE id = ?', [insert.insertId]);
    }
  });

  const reviewed = await get('SELECT * FROM faq_article_access_requests WHERE id = ?', [requestId]);
  await emitSystemEvent({
    eventType: nextStatus === 'approved' ? 'FAQ_ACCESS_REQUEST_APPROVED' : 'FAQ_ACCESS_REQUEST_REJECTED',
    articleId: Number(requestRow.article_id),
    req,
    payload: buildAccessRequestNoticePayload({ type: nextStatus, article, requestRow: reviewed, reviewRow: reviewed }),
  });
  res.json({ request: reviewed, grant });
}));

app.post('/api/faq/access-grants/:id/revoke', asyncHandler(async (req, res) => {
  const grantId = Number(req.params.id);
  if (!Number.isFinite(grantId) || grantId <= 0) throw appError('授权ID无效', 400);
  const grant = await get('SELECT * FROM faq_article_access_grants WHERE id = ?', [grantId]);
  if (!grant) throw appError('授权不存在', 404);
  if (!canReviewDepartmentRequest(req.user, grant.target_department_code)) {
    throw appError('仅目标部门文档管理员可撤销授权', 403);
  }
  await run(
    `UPDATE faq_article_access_grants
     SET status = 'revoked', revoked_by_id = ?, revoked_by_name = ?, revoked_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id) || 0, req.user.username, grantId]
  );
  const article = await getArticleWithCategory(Number(grant.article_id));
  await emitSystemEvent({
    eventType: 'FAQ_ACCESS_GRANT_REVOKED',
    articleId: Number(grant.article_id),
    req,
    payload: buildAccessRequestNoticePayload({ type: 'revoked', article, requestRow: grant, reviewRow: grant }),
  });
  res.json({ ok: true });
}));

app.put('/api/faq/articles/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('文章ID无效', 400);

  const before = await ensureArticleExists(id);
  const beforeAccess = await resolveArticleAccessForRequest(req, before);
  if (!beforeAccess.canManage && !canManageDepartmentLibrary(req, before.department_code)) {
    throw appError('仅管理员、编辑或部门文档管理员可更新该文档', 403);
  }

  const title = trimText(req.body?.title) || before.title;
  const summary = req.body?.summary === undefined ? before.summary : trimText(req.body.summary) || null;
  const categoryId = Number(req.body?.category_id);
  const tags = req.body?.tags === undefined ? toJson(before.tags_json, []) : parseTags(req.body.tags);
  const scopePayload = normalizeArticleScopeInput(req, req.body, before.department_code || getRequestDepartmentCode(req));
  const categoryValue = Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null;
  if (categoryValue) {
    await ensureCategoryMatchesLibrary({
      categoryId: categoryValue,
      libraryScope: scopePayload.library_scope,
      departmentCode: scopePayload.department_code,
    });
  }

  await run(
    `UPDATE faq_articles
     SET title = ?, summary = ?, category_id = ?, library_scope = ?, department_code = ?, tags_json = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      title,
      summary,
      categoryValue,
      scopePayload.library_scope,
      scopePayload.department_code,
      JSON.stringify(tags),
      Number(req.user.id) || null,
      req.user.username,
      id,
    ]
  );

  const after = await ensureArticleExists(id);
  await logOperation({ req, articleId: id, action: 'ARTICLE_UPDATE', message: `更新FAQ「${title}」`, beforeData: before, afterData: after });
  res.json({ ...after, tags });
}));

app.put('/api/faq/articles/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('文章ID无效', 400);

  const before = await ensureArticleExists(id);
  const nextStatus = normalizeStatus(req.body?.status);

  if (nextStatus === 'published') {
    const currentVersion = await getVersionById({ articleId: id, versionId: Number(before.current_version_id) });
    if (!currentVersion) throw appError('请先上传文档版本后再发布', 400);

    const precheck = await buildPublishPrecheck({
      article: before,
      version: currentVersion,
      operatorUserId: Number(req.user.id),
    });
    if (!precheck.ok) {
      return res.status(409).json({
        error: '发布校验未通过',
        checks: precheck.checks,
        active_lock: precheck.active_lock,
      });
    }

    const publishNote = normalizePublishNote(req.body?.publish_note);
    const published = await publishArticleVersion({
      article: before,
      version: currentVersion,
      req,
      publishNote,
      action: 'ARTICLE_STATUS',
    });
    return res.json({
      ...published.article,
      publish_note: publishNote || null,
      checks: precheck.checks,
    });
  }

  await run('UPDATE faq_article_versions SET is_published_version = 0 WHERE article_id = ?', [id]);

  await run(
    `UPDATE faq_articles
     SET status = ?,
         published_version_id = ?,
         published_by_id = ?,
         published_by_name = ?,
         published_at = ?,
         updated_by_id = ?,
         updated_by_name = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [nextStatus, null, null, null, null, Number(req.user.id) || null, req.user.username, id]
  );

  const after = await ensureArticleExists(id);
  await logOperation({ req, articleId: id, action: 'ARTICLE_STATUS', message: `状态变更为 ${nextStatus}`, beforeData: before, afterData: after });
  return res.json(after);
}));

app.put('/api/faq/articles/:id/pin', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('文章ID无效', 400);

  const before = await ensureArticleExists(id);
  const pinned = req.body?.is_pinned ? 1 : 0;

  await run(
    `UPDATE faq_articles
     SET is_pinned = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [pinned, Number(req.user.id) || null, req.user.username, id]
  );

  const after = await ensureArticleExists(id);
  await logOperation({ req, articleId: id, action: 'ARTICLE_PIN', message: pinned ? '置顶FAQ' : '取消置顶FAQ', beforeData: before, afterData: after });
  res.json(after);
}));

app.post('/api/faq/articles/batch', requireAdmin, asyncHandler(async (req, res) => {
  const action = trimText(req.body?.action).toLowerCase();
  const idsRaw = Array.isArray(req.body?.article_ids) ? req.body.article_ids : [];
  const articleIds = Array.from(
    new Set(
      idsRaw
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
  if (!articleIds.length) throw appError('请选择至少一篇FAQ', 400);

  const placeholders = articleIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT id, title, category_id, status, current_version_id, is_deleted, deleted_at, purge_after
     FROM faq_articles
     WHERE id IN (${placeholders})`,
    articleIds
  );
  if (rows.length !== articleIds.length) throw appError('存在无效文章ID', 400);
  const guard = getArticleBatchActionGuard({ action, rows });
  if (!guard.ok) throw appError(guard.error, guard.status);

  if (action === 'publish') {
    const invalid = rows.filter((item) => !Number(item.current_version_id));
    if (invalid.length) throw appError(`以下文章缺少版本，无法发布：${invalid.map((item) => item.title).join('、')}`, 409);
    await transaction(async (tx) => {
      for (const item of rows) {
        await tx.run('UPDATE faq_article_versions SET is_published_version = 0 WHERE article_id = ?', [Number(item.id)]);
        await tx.run('UPDATE faq_article_versions SET is_published_version = 1 WHERE id = ?', [Number(item.current_version_id)]);
        await tx.run(
          `UPDATE faq_articles
           SET status = 'published',
               published_version_id = current_version_id,
               published_by_id = ?,
               published_by_name = ?,
               published_at = NOW(),
               updated_by_id = ?,
               updated_by_name = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [Number(req.user.id) || null, req.user.username, Number(req.user.id) || null, req.user.username, Number(item.id)]
        );
      }
    });
  } else if (action === 'archive') {
    await run(
      `UPDATE faq_articles
       SET status = 'archived',
           updated_by_id = ?,
           updated_by_name = ?,
           updated_at = NOW()
       WHERE id IN (${placeholders})`,
      [Number(req.user.id) || null, req.user.username, ...articleIds]
    );
  } else if (action === 'delete') {
    const retentionDays = normalizeRetentionDays(req.body?.retention_days);
    const purgeAfter = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
    await run(
      `UPDATE faq_articles
       SET is_deleted = 1,
           deleted_at = NOW(),
           deleted_by_id = ?,
           deleted_by_name = ?,
           purge_after = ?,
           status = 'archived',
           updated_by_id = ?,
           updated_by_name = ?,
           updated_at = NOW()
       WHERE id IN (${placeholders})`,
      [
        Number(req.user.id) || null,
        req.user.username,
        formatDateTime(purgeAfter),
        Number(req.user.id) || null,
        req.user.username,
        ...articleIds,
      ]
    );
    await run(
      `UPDATE faq_editor_sessions
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE status = 'active' AND article_id IN (${placeholders})`,
      articleIds
    );
  } else if (action === 'category') {
    const categoryIdRaw = req.body?.category_id;
    const categoryId = Number(categoryIdRaw);
    let targetCategory = null;
    if (categoryIdRaw !== null && categoryIdRaw !== '' && categoryIdRaw !== undefined) {
      if (!Number.isFinite(categoryId) || categoryId <= 0) throw appError('分类ID无效', 400);
      targetCategory = await get('SELECT id FROM faq_categories WHERE id = ?', [categoryId]);
      if (!targetCategory) throw appError('目标分类不存在', 404);
    }
    await run(
      `UPDATE faq_articles
       SET category_id = ?,
           updated_by_id = ?,
           updated_by_name = ?,
           updated_at = NOW()
       WHERE id IN (${placeholders})`,
      [targetCategory ? Number(targetCategory.id) : null, Number(req.user.id) || null, req.user.username, ...articleIds]
    );
  } else if (action === 'restore') {
    await run(
      `UPDATE faq_articles
       SET is_deleted = 0,
           deleted_at = NULL,
           deleted_by_id = NULL,
           deleted_by_name = NULL,
           purge_after = NULL,
           updated_by_id = ?,
           updated_by_name = ?,
           updated_at = NOW()
       WHERE id IN (${placeholders})`,
      [Number(req.user.id) || null, req.user.username, ...articleIds]
    );
  } else if (action === 'purge') {
    for (const item of rows) {
      const removed = await hardDeleteArticleById(Number(item.id));
      if (!removed) continue;
      await logArticlePurgedOperation({
        req,
        articleId: Number(item.id),
        title: item.title,
        deletedAt: item.deleted_at,
        purgeAfter: item.purge_after,
        manual: true,
      });
      await emitArticlePurgedEvent({
        req,
        articleId: Number(item.id),
        title: item.title,
        deletedAt: item.deleted_at,
        purgeAfter: item.purge_after,
        manual: true,
      });
    }
  } else {
    throw appError('不支持的批量操作', 400);
  }

  await logOperation({
    req,
    action: 'ARTICLE_BATCH',
    message: `批量操作 ${action}，数量 ${articleIds.length}`,
    afterData: {
      action,
      article_ids: articleIds,
      total: articleIds.length,
    },
  });

  res.json({ ok: true, action, total: articleIds.length, article_ids: articleIds });
}));

app.delete('/api/faq/articles/:id', requireAdmin, asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  const before = await ensureArticleExists(articleId);
  const retentionDays = normalizeRetentionDays(req.query.retention_days || req.body?.retention_days);
  const purgeAfter = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

  await run(
    `UPDATE faq_articles
     SET is_deleted = 1,
         deleted_at = NOW(),
         deleted_by_id = ?,
         deleted_by_name = ?,
         purge_after = ?,
         status = 'archived',
         updated_by_id = ?,
         updated_by_name = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      Number(req.user.id) || null,
      req.user.username,
      formatDateTime(purgeAfter),
      Number(req.user.id) || null,
      req.user.username,
      articleId,
    ]
  );

  await run(
    `UPDATE faq_editor_sessions
     SET status = 'released', released_at = NOW(), updated_at = NOW()
     WHERE article_id = ? AND status = 'active'`,
    [articleId]
  );

  await logOperation({
    req,
    articleId,
    action: 'ARTICLE_RECYCLE',
    message: `删除FAQ到回收站「${before.title}」`,
    beforeData: before,
    afterData: {
      retention_days: retentionDays,
      purge_after: formatDateTime(purgeAfter),
    },
  });
  await emitSystemEvent({
    req,
    eventType: 'FAQ_RECYCLED',
    articleId,
    payload: {
      article_title: trimText(before.title),
      retention_days: retentionDays,
      purge_after: formatDateTime(purgeAfter),
    },
  });

  res.json({
    ok: true,
    recycled_article_id: articleId,
    retention_days: retentionDays,
    purge_after: formatDateTime(purgeAfter),
  });
}));

app.post('/api/faq/articles/:id/restore', requireAdmin, asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  const before = await ensureArticleExists(articleId, { includeDeleted: true });
  if (Number(before.is_deleted || 0) !== 1) throw appError('该文章不在回收站中', 409);

  await run(
    `UPDATE faq_articles
     SET is_deleted = 0,
         deleted_at = NULL,
         deleted_by_id = NULL,
         deleted_by_name = NULL,
         purge_after = NULL,
         updated_by_id = ?,
         updated_by_name = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id) || null, req.user.username, articleId]
  );
  const after = await ensureArticleExists(articleId, { includeDeleted: true });

  await logOperation({
    req,
    articleId,
    action: 'ARTICLE_RESTORE',
    message: `恢复回收站FAQ「${before.title}」`,
    beforeData: before,
    afterData: after,
  });
  await emitSystemEvent({
    req,
    eventType: 'FAQ_RESTORED',
    articleId,
    payload: {
      article_title: trimText(before.title),
    },
  });

  res.json(after);
}));

app.post('/api/faq/articles/:id/upload', uploadSingle('file'), asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  const { article } = await ensureManageableArticle(req, articleId);
  if (!req.file?.path) throw appError('请上传文件', 400);

  const ext = normalizeUploadExt(req.file.originalname || req.file.filename || '');
  if (!ext) throw appError('仅支持 doc/docx/pdf 文件', 400);

  let previewFilePath = null;
  let editableFilePath = null;
  let renderType = ext === '.pdf' ? 'pdf_inline' : 'docx_html';
  let renderStatus = 'ready';
  let renderError = null;
  let searchText = '';

  try {
    if (ext === '.docx') {
      const previewPath = path.join(PREVIEW_ROOT, buildStoredFilename(req.file.filename, '.html'));
      await convertDocxToHtml(req.file.path, previewPath, article.title);
      previewFilePath = previewPath;
      editableFilePath = req.file.path;
      renderType = 'docx_html';
    } else if (ext === '.doc') {
      const convertedDocx = await runLibreOfficeConvert(req.file.path, EDITABLE_ROOT, 'docx');
      try {
        editableFilePath = await copyToManagedPath(convertedDocx, EDITABLE_ROOT, '.docx');
      } finally {
        await deleteFileSafe(convertedDocx);
      }

      const convertedPdf = await runLibreOfficeConvert(req.file.path, PREVIEW_ROOT, 'pdf');
      try {
        previewFilePath = await copyToManagedPath(convertedPdf, PREVIEW_ROOT, '.pdf');
      } finally {
        await deleteFileSafe(convertedPdf);
      }
      renderType = 'pdf_inline';
    } else {
      previewFilePath = req.file.path;
      editableFilePath = null;
      renderType = 'pdf_inline';
    }
  } catch (err) {
    renderStatus = 'failed';
    renderError = trimText(err.message).slice(0, 1000) || '转换失败';
  }

  searchText = await buildSearchTextByUpload({
    ext,
    uploadPath: req.file.path,
    editablePath: editableFilePath,
  });

  const created = await transaction(async (tx) => {
    const nextVersion = await getNextVersionNo(tx, articleId);

    const insert = await tx.run(
      `INSERT INTO faq_article_versions
        (article_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type,
         editable_file_path, preview_file_path, render_type, render_status, render_error, search_text, is_published_version,
         parent_version_id, created_by_id, created_by_name)
       VALUES (?, ?, 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        articleId,
        nextVersion,
        ext.slice(1),
        req.file.path,
        req.file.originalname || req.file.filename,
        Number(req.file.size || 0),
        trimText(req.file.mimetype) || guessMimeByExt(ext),
        editableFilePath,
        previewFilePath,
        renderType,
        renderStatus,
        renderError,
        searchText,
        Number(article.current_version_id) || null,
        Number(req.user.id) || null,
        req.user.username,
      ]
    );

    await tx.run(
      `UPDATE faq_articles
       SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [insert.insertId, Number(req.user.id) || null, req.user.username, articleId]
    );

    return tx.get('SELECT * FROM faq_article_versions WHERE id = ?', [insert.insertId]);
  });

  await logOperation({
    req,
    articleId,
    action: 'VERSION_UPLOAD',
    message: `上传版本 ${created.version_no}`,
    afterData: {
      version_id: created.id,
      version_no: created.version_no,
      source_ext: created.source_ext,
      render_status: created.render_status,
    },
  });

  res.status(201).json(created);
}));

app.get('/api/faq/articles/:id/versions', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  await ensureReadableArticle(req, articleId);
  const rows = await query(
    `SELECT *
     FROM faq_article_versions
     WHERE article_id = ?
     ORDER BY version_no DESC, id DESC`,
    [articleId]
  );
  res.json(rows);
}));

app.get('/api/faq/articles/:id/versions/compare', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  const leftVersionId = Number(req.query.left_version_id || req.query.left || 0);
  const rightVersionId = Number(req.query.right_version_id || req.query.right || 0);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  if (!Number.isFinite(leftVersionId) || leftVersionId <= 0) throw appError('左侧版本ID无效', 400);
  if (!Number.isFinite(rightVersionId) || rightVersionId <= 0) throw appError('右侧版本ID无效', 400);
  if (leftVersionId === rightVersionId) throw appError('请至少选择两个不同版本进行对比', 400);

  await ensureReadableArticle(req, articleId);
  const [leftVersion, rightVersion] = await Promise.all([
    getVersionById({ articleId, versionId: leftVersionId }),
    getVersionById({ articleId, versionId: rightVersionId }),
  ]);
  if (!leftVersion || !rightVersion) throw appError('版本不存在或不属于当前文章', 404);

  const [leftText, rightText] = await Promise.all([
    resolveVersionSearchText(leftVersion),
    resolveVersionSearchText(rightVersion),
  ]);

  if (!leftText && !rightText) {
    return res.json({
      left_version: leftVersion,
      right_version: rightVersion,
      comparable: false,
      reason: '两个版本都缺少可提取文本，暂不支持对比',
      summary: null,
      entries: [],
    });
  }

  const diffPayload = buildVersionDiffResult({ leftText, rightText });
  return res.json({
    left_version: leftVersion,
    right_version: rightVersion,
    comparable: true,
    ...diffPayload,
  });
}));

app.post('/api/faq/articles/:id/publish/check', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  const { article } = await ensureManageableArticle(req, articleId);
  const targetVersionId = Number(req.body?.version_id || article.current_version_id || 0);
  const targetVersion = await getVersionById({ articleId, versionId: targetVersionId });

  const precheck = await buildPublishPrecheck({
    article,
    version: targetVersion,
    operatorUserId: Number(req.user.id),
  });

  return res.json({
    ok: precheck.ok,
    requires_review: !canReviewPublish(req),
    target_version: targetVersion,
    checks: precheck.checks,
    active_lock: precheck.active_lock,
  });
}));

app.post('/api/faq/articles/:id/publish', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  const { article } = await ensureManageableArticle(req, articleId);
  const targetVersionId = Number(req.body?.version_id || article.current_version_id || 0);
  const targetVersion = await getVersionById({ articleId, versionId: targetVersionId });
  if (!targetVersion) throw appError('目标版本不存在，请先上传或选择版本', 404);

  const publishNote = normalizePublishNote(req.body?.publish_note);
  if (!publishNote) throw appError('请填写发布说明', 400);

  const precheck = await buildPublishPrecheck({
    article,
    version: targetVersion,
    operatorUserId: Number(req.user.id),
  });
  if (!precheck.ok) {
    return res.status(409).json({
      error: '发布校验未通过',
      checks: precheck.checks,
      active_lock: precheck.active_lock,
    });
  }

  const mode = trimText(req.body?.mode).toLowerCase();
  const shouldReview = mode === 'review' || !canReviewPublish(req);
  if (shouldReview) {
    await run(
      `DELETE FROM faq_publish_requests
       WHERE article_id = ?
         AND requester_id = ?
         AND status = 'pending'`,
      [articleId, Number(req.user.id) || 0]
    );
    const insert = await run(
      `INSERT INTO faq_publish_requests
        (article_id, target_version_id, publish_note, status, requester_id, requester_name)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [articleId, Number(targetVersion.id), publishNote, Number(req.user.id) || 0, req.user.username]
    );
    const requestRow = await get('SELECT * FROM faq_publish_requests WHERE id = ?', [insert.insertId]);
    await logOperation({
      req,
      articleId,
      action: 'PUBLISH_REQUEST_CREATE',
      message: `提交发布审批：v${targetVersion.version_no}`,
      afterData: {
        request_id: insert.insertId,
        target_version_id: targetVersion.id,
        publish_note: publishNote,
      },
    });
    await emitSystemEvent({
      req,
      eventType: 'FAQ_PUBLISH_REQUEST_CREATED',
      articleId,
      payload: {
        article_title: trimText(article.title),
        version_no: Number(targetVersion.version_no) || null,
        requester_name: req.user.username,
        publish_note: publishNote,
      },
    });

    return res.status(201).json({
      mode: 'review',
      request: requestRow,
      checks: precheck.checks,
    });
  }

  const published = await publishArticleVersion({
    article,
    version: targetVersion,
    req,
    publishNote,
    action: 'ARTICLE_PUBLISH',
  });
  await run(
    `UPDATE faq_publish_requests
     SET status = 'cancelled',
         reviewer_id = ?,
         reviewer_name = ?,
         reviewed_at = NOW(),
         review_comment = COALESCE(review_comment, '管理员直接发布，待审单自动关闭')
     WHERE article_id = ?
       AND status = 'pending'`,
    [Number(req.user.id) || null, req.user.username, articleId]
  );
  await emitSystemEvent({
    req,
    eventType: 'FAQ_PUBLISHED',
    articleId,
    payload: {
      article_title: trimText(article.title),
      version_no: Number(targetVersion.version_no) || null,
      publish_note: publishNote,
      mode: 'direct',
    },
  });

  return res.json({
    mode: 'direct',
    article: published.article,
    version: published.version,
    checks: precheck.checks,
  });
}));

app.get('/api/faq/articles/:id/publish-requests', asyncHandler(async (req, res) => {
  if (!canWriteFaq(req) && !canReviewPublish(req)) throw appError('无权限查看发布审批记录', 403);
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureReadableArticle(req, articleId);
  const limit = Math.min(30, toBoundedLimit(req.query.limit, 10));

  const rows = await query(
    `SELECT r.*, v.version_no
     FROM faq_publish_requests r
     LEFT JOIN faq_article_versions v ON v.id = r.target_version_id
     WHERE r.article_id = ?
       ${canReviewPublish(req) ? '' : 'AND r.requester_id = ?'}
     ORDER BY r.id DESC
     LIMIT ?`,
    canReviewPublish(req) ? [articleId, limit] : [articleId, Number(req.user.id) || 0, limit]
  );

  res.json(rows);
}));

app.post('/api/faq/articles/:id/versions/:versionId/restore', requireAdmin, asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  if (!Number.isFinite(versionId) || versionId <= 0) throw appError('版本ID无效', 400);

  const article = await ensureArticleExists(articleId);
  const target = await get('SELECT * FROM faq_article_versions WHERE id = ? AND article_id = ?', [versionId, articleId]);
  if (!target) throw appError('目标版本不存在', 404);

  const restored = await transaction(async (tx) => {
    const nextVersion = await getNextVersionNo(tx, articleId);

    const storageExt = `.${trimText(target.source_ext).toLowerCase()}`;
    const copiedStorage = await copyToManagedPath(target.storage_path, UPLOAD_ROOT, storageExt);

    let copiedEditable = null;
    if (trimText(target.editable_file_path)) {
      copiedEditable = await copyToManagedPath(target.editable_file_path, EDITABLE_ROOT, '.docx');
    }

    let copiedPreview = null;
    if (trimText(target.preview_file_path)) {
      const previewExt = path.extname(String(target.preview_file_path || '')).toLowerCase() || '.html';
      copiedPreview = await copyToManagedPath(target.preview_file_path, PREVIEW_ROOT, previewExt);
    }

    const insert = await tx.run(
      `INSERT INTO faq_article_versions
        (article_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type,
         editable_file_path, preview_file_path, render_type, render_status, render_error, search_text, is_published_version,
         parent_version_id, created_by_id, created_by_name)
       VALUES (?, ?, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        articleId,
        nextVersion,
        target.source_ext,
        copiedStorage,
        target.file_name,
        target.file_size,
        target.mime_type,
        copiedEditable,
        copiedPreview,
        target.render_type,
        target.render_status,
        target.render_error,
        normalizeSearchText(target.search_text),
        target.id,
        Number(req.user.id) || null,
        req.user.username,
      ]
    );

    await tx.run(
      `UPDATE faq_articles
       SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [insert.insertId, Number(req.user.id) || null, req.user.username, articleId]
    );

    if (trimText(article.status).toLowerCase() === 'published') {
      await tx.run('UPDATE faq_article_versions SET is_published_version = 0 WHERE article_id = ?', [articleId]);
      await tx.run('UPDATE faq_article_versions SET is_published_version = 1 WHERE id = ?', [insert.insertId]);
      await tx.run(
        `UPDATE faq_articles
         SET published_version_id = ?, published_by_id = ?, published_by_name = ?, published_at = NOW()
         WHERE id = ?`,
        [insert.insertId, Number(req.user.id) || null, req.user.username, articleId]
      );
    }

    return tx.get('SELECT * FROM faq_article_versions WHERE id = ?', [insert.insertId]);
  });

  await logOperation({
    req,
    articleId,
    action: 'VERSION_RESTORE',
    message: `回滚版本 ${target.version_no} -> ${restored.version_no}`,
    beforeData: { from: target.id, from_no: target.version_no },
    afterData: { to: restored.id, to_no: restored.version_no },
  });

  res.status(201).json(restored);
}));

app.get('/api/faq/versions/:versionId/preview', asyncHandler(async (req, res) => {
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(versionId) || versionId <= 0) throw appError('版本ID无效', 400);

  const version = await get('SELECT * FROM faq_article_versions WHERE id = ?', [versionId]);
  if (!version) throw appError('版本不存在', 404);
  await ensureReadableArticle(req, Number(version.article_id));

  const renderType = trimText(version.render_type).toLowerCase();

  if (renderType === 'pdf_inline') {
    const target = trimText(version.preview_file_path) || trimText(version.storage_path);
    const stat = await readFileStatSafe(target);
    if (!stat || !stat.isFile()) throw appError('预览文件不存在', 404);

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(version.file_name || 'preview.pdf')}`);
    return res.sendFile(target);
  }

  const htmlPath = trimText(version.preview_file_path);
  const stat = await readFileStatSafe(htmlPath);
  if (htmlPath && stat?.isFile()) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(htmlPath);
  }

  throw appError('当前版本无可用预览', 409);
}));

app.get('/api/faq/versions/:versionId/download', asyncHandler(async (req, res) => {
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(versionId) || versionId <= 0) throw appError('版本ID无效', 400);

  const version = await get('SELECT * FROM faq_article_versions WHERE id = ?', [versionId]);
  if (!version) throw appError('版本不存在', 404);
  await ensureReadableArticle(req, Number(version.article_id));

  const variant = trimText(req.query.variant).toLowerCase();
  const inline = req.query.inline === '1';

  let target = trimText(version.storage_path);
  let filename = version.file_name || `faq-version-${version.id}.${version.source_ext || 'bin'}`;
  let mime = trimText(version.mime_type) || guessMimeByExt(`.${version.source_ext}`);

  if (variant === 'editable' && trimText(version.editable_file_path)) {
    target = trimText(version.editable_file_path);
    filename = `${path.parse(filename).name || `faq-version-${version.id}`}.docx`;
    mime = guessMimeByExt('.docx');
  }

  const stat = await readFileStatSafe(target);
  if (!stat || !stat.isFile()) throw appError('文件不存在', 404);

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return res.sendFile(target);
}));

app.post('/api/faq/articles/:id/favorite', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureReadableArticle(req, articleId);

  await run(
    `INSERT INTO faq_favorites (article_id, user_id, username)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE username = VALUES(username)`,
    [articleId, Number(req.user.id) || 0, req.user.username]
  );

  res.json({ ok: true });
}));

app.delete('/api/faq/articles/:id/favorite', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  await run('DELETE FROM faq_favorites WHERE article_id = ? AND user_id = ?', [articleId, Number(req.user.id) || 0]);
  res.json({ ok: true });
}));

app.get('/api/faq/favorites', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT f.*, a.title, a.summary, a.status, a.is_pinned, a.updated_at, a.library_scope, a.department_code, a.tags_json
     FROM faq_favorites f
     JOIN faq_articles a ON a.id = f.article_id
     WHERE f.user_id = ?
       AND a.is_deleted = 0
     ORDER BY f.created_at DESC`,
    [Number(req.user.id) || 0]
  );
  const grantMap = await getGrantMapForArticles({
    articleIds: rows.map((item) => Number(item.article_id || 0)),
    userId: Number(req.user.id) || 0,
  });
  res.json(
    rows
      .map((item) => {
        const access = resolveArticleAccess({
          user: req.user,
          article: item,
          activeGrant: grantMap.get(Number(item.article_id || 0)),
        });
        return sanitizeArticleForList(item, access);
      })
      .filter((item) => item.visibility !== 'forbidden')
  );
}));

app.post('/api/faq/articles/:id/feedback', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  const { article } = await ensureReadableArticle(req, articleId);

  const solved =
    req.body?.solved === false || req.body?.solved === 0 || String(req.body?.solved).toLowerCase() === 'false'
      ? 0
      : 1;
  const reasonCode = solved ? null : normalizeFeedbackReasonCode(req.body?.reason_code) || 'other';
  const reasonText = trimText(req.body?.reason_text).slice(0, 500) || null;
  const versionIdRaw = Number(req.body?.version_id);
  const preferredVersionId =
    Number.isFinite(versionIdRaw) && versionIdRaw > 0
      ? versionIdRaw
      : Number(article.published_version_id) || Number(article.current_version_id) || null;

  if (!solved && !reasonText && reasonCode === 'other') {
    throw appError('请填写未解决原因或选择具体原因', 400);
  }

  await run(
    `INSERT INTO faq_article_feedback
      (article_id, version_id, user_id, username, solved, reason_code, reason_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       version_id = VALUES(version_id),
       username = VALUES(username),
       solved = VALUES(solved),
       reason_code = VALUES(reason_code),
       reason_text = VALUES(reason_text),
       updated_at = NOW()`,
    [
      articleId,
      preferredVersionId,
      Number(req.user.id) || 0,
      req.user.username,
      solved,
      reasonCode,
      reasonText,
    ]
  );

  const myFeedback = await get(
    `SELECT id, article_id, version_id, user_id, username, solved, reason_code, reason_text, created_at, updated_at
     FROM faq_article_feedback
     WHERE article_id = ? AND user_id = ?
     LIMIT 1`,
    [articleId, Number(req.user.id) || 0]
  );
  await logOperation({
    req,
    articleId,
    action: 'FEEDBACK_UPSERT',
    message: solved ? '标记FAQ已解决' : '提交FAQ未解决反馈',
    afterData: {
      solved: solved === 1,
      reason_code: reasonCode,
      reason_text: reasonText,
    },
  });

  res.json({
    ok: true,
    feedback: myFeedback
      ? {
          ...myFeedback,
          solved: Number(myFeedback.solved || 0) === 1,
        }
      : null,
  });
}));

app.get('/api/faq/articles/:id/feedback/summary', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureReadableArticle(req, articleId);

  const [summaryRow, reasonRows, myFeedback] = await Promise.all([
    get(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) AS solved_total,
        SUM(CASE WHEN solved = 0 THEN 1 ELSE 0 END) AS unsolved_total
       FROM faq_article_feedback
       WHERE article_id = ?`,
      [articleId]
    ),
    query(
      `SELECT reason_code, COUNT(1) AS total
       FROM faq_article_feedback
       WHERE article_id = ?
         AND solved = 0
         AND reason_code IS NOT NULL
         AND reason_code <> ''
       GROUP BY reason_code
       ORDER BY total DESC
       LIMIT 8`,
      [articleId]
    ),
    get(
      `SELECT id, solved, reason_code, reason_text, version_id, created_at, updated_at
       FROM faq_article_feedback
       WHERE article_id = ? AND user_id = ?
       LIMIT 1`,
      [articleId, Number(req.user.id) || 0]
    ),
  ]);

  const total = Number(summaryRow?.total || 0);
  const solvedTotal = Number(summaryRow?.solved_total || 0);
  const unsolvedTotal = Number(summaryRow?.unsolved_total || 0);

  res.json({
    total,
    solved_total: solvedTotal,
    unsolved_total: unsolvedTotal,
    solved_rate: total > 0 ? Number((solvedTotal / total).toFixed(4)) : 0,
    reasons: reasonRows.map((item) => {
      const code = trimText(item.reason_code);
      return {
        reason_code: code,
        reason_label: FEEDBACK_REASON_LABELS[code] || code || '其他',
        total: Number(item.total || 0),
      };
    }),
    my_feedback: myFeedback
      ? {
          ...myFeedback,
          solved: Number(myFeedback.solved || 0) === 1,
        }
      : null,
  });
}));

app.get('/api/faq/recent', asyncHandler(async (req, res) => {
  const limit = Math.min(30, toBoundedLimit(req.query.limit, 8));
  const rows = await query(
    `SELECT
      a.id,
      a.title,
      a.summary,
      a.status,
      a.library_scope,
      a.department_code,
      a.tags_json,
      a.category_id,
      a.updated_at,
      MAX(v.created_at) AS last_viewed_at
     FROM faq_view_events v
     JOIN faq_articles a ON a.id = v.article_id
     WHERE a.is_deleted = 0
       AND v.viewer_id = ?
     GROUP BY a.id, a.title, a.summary, a.status, a.library_scope, a.department_code, a.tags_json, a.category_id, a.updated_at
     ORDER BY last_viewed_at DESC
     LIMIT ?`,
    [Number(req.user.id) || 0, limit]
  );
  const grantMap = await getGrantMapForArticles({
    articleIds: rows.map((item) => Number(item.id || 0)),
    userId: Number(req.user.id) || 0,
  });
  res.json(
    rows
      .map((item) => sanitizeArticleForList(
        item,
        resolveArticleAccess({
          user: req.user,
          article: item,
          activeGrant: grantMap.get(Number(item.id || 0)),
        })
      ))
      .filter((item) => item.visibility !== 'forbidden')
  );
}));

app.post('/api/faq/articles/:id/view', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureReadableArticle(req, articleId);

  await transaction(async (tx) => {
    await tx.run(
      `INSERT INTO faq_view_events (article_id, viewer_id, viewer_name)
       VALUES (?, ?, ?)`,
      [articleId, Number(req.user.id) || null, req.user.username || null]
    );

    await tx.run(
      `INSERT INTO faq_view_daily (article_id, day, view_count)
       VALUES (?, CURDATE(), 1)
       ON DUPLICATE KEY UPDATE view_count = view_count + 1`,
      [articleId]
    );
  });

  res.json({ ok: true });
}));

app.get('/api/faq/stats/overview', asyncHandler(async (_req, res) => {
  const articleTotal = await get('SELECT COUNT(1) AS count FROM faq_articles WHERE is_deleted = 0');
  const recycleTotal = await get('SELECT COUNT(1) AS count FROM faq_articles WHERE is_deleted = 1');
  const publishedTotal = await get("SELECT COUNT(1) AS count FROM faq_articles WHERE is_deleted = 0 AND status = 'published'");
  const draftTotal = await get("SELECT COUNT(1) AS count FROM faq_articles WHERE is_deleted = 0 AND status = 'draft'");
  const archivedTotal = await get("SELECT COUNT(1) AS count FROM faq_articles WHERE is_deleted = 0 AND status = 'archived'");
  const favoritesTotal = await get(
    `SELECT COUNT(1) AS count
     FROM faq_favorites f
     JOIN faq_articles a ON a.id = f.article_id
     WHERE a.is_deleted = 0`
  );
  const viewsTotal = await get(
    `SELECT COUNT(1) AS count
     FROM faq_view_events v
     JOIN faq_articles a ON a.id = v.article_id
     WHERE a.is_deleted = 0`
  );
  const todayViews = await get(
    `SELECT COUNT(1) AS count
     FROM faq_view_events v
     JOIN faq_articles a ON a.id = v.article_id
     WHERE a.is_deleted = 0
       AND DATE(v.created_at) = CURDATE()`
  );
  const feedbackTotal = await get(
    `SELECT COUNT(1) AS count
     FROM faq_article_feedback f
     JOIN faq_articles a ON a.id = f.article_id
     WHERE a.is_deleted = 0`
  );
  const feedbackSolvedTotal = await get(
    `SELECT COUNT(1) AS count
     FROM faq_article_feedback f
     JOIN faq_articles a ON a.id = f.article_id
     WHERE a.is_deleted = 0
       AND f.solved = 1`
  );
  const publishPendingTotal = await get("SELECT COUNT(1) AS count FROM faq_publish_requests WHERE status = 'pending'");

  res.json({
    article_total: Number(articleTotal?.count || 0),
    recycle_total: Number(recycleTotal?.count || 0),
    published_total: Number(publishedTotal?.count || 0),
    draft_total: Number(draftTotal?.count || 0),
    archived_total: Number(archivedTotal?.count || 0),
    favorites_total: Number(favoritesTotal?.count || 0),
    views_total: Number(viewsTotal?.count || 0),
    today_views: Number(todayViews?.count || 0),
    feedback_total: Number(feedbackTotal?.count || 0),
    feedback_solved_total: Number(feedbackSolvedTotal?.count || 0),
    publish_pending_total: Number(publishPendingTotal?.count || 0),
  });
}));

app.get('/api/faq/stats/trend', asyncHandler(async (req, res) => {
  const days = Math.max(7, Math.min(90, toPositiveInt(req.query.days, 14)));
  const rows = await query(
    `SELECT DATE(v.created_at) AS day, COUNT(1) AS views
     FROM faq_view_events v
     JOIN faq_articles a ON a.id = v.article_id
     WHERE a.is_deleted = 0
       AND v.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(v.created_at)
     ORDER BY day ASC`,
    [days]
  );
  res.json(rows.map((item) => ({ day: item.day, views: Number(item.views || 0) })));
}));

app.get('/api/faq/stats/top', asyncHandler(async (req, res) => {
  const limit = Math.min(50, toBoundedLimit(req.query.limit, 10));
  const rows = await query(
    `SELECT a.id AS article_id, a.title, COUNT(1) AS views
     FROM faq_view_events v
     JOIN faq_articles a ON a.id = v.article_id
     WHERE a.is_deleted = 0
     GROUP BY a.id, a.title
     ORDER BY views DESC, a.id DESC
     LIMIT ?`,
    [limit]
  );
  res.json(rows.map((item) => ({ ...item, views: Number(item.views || 0) })));
}));

app.get('/api/faq/stats/content-health', asyncHandler(async (req, res) => {
  const staleDays = Math.max(7, Math.min(365, toPositiveInt(req.query.stale_days, 30)));
  const zeroViewDays = Math.max(7, Math.min(365, toPositiveInt(req.query.zero_view_days, 30)));
  const recycleWarnDays = Math.max(1, Math.min(30, toPositiveInt(req.query.recycle_warn_days, 7)));

  const staleRows = await query(
    `SELECT id, title, status, updated_at
     FROM faq_articles
     WHERE is_deleted = 0
       AND status = 'published'
       AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY updated_at ASC
     LIMIT 50`,
    [staleDays]
  );
  const zeroViewRows = await query(
    `SELECT a.id, a.title, a.updated_at
     FROM faq_articles a
     LEFT JOIN (
       SELECT article_id, COUNT(1) AS views_30d
       FROM faq_view_events
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY article_id
     ) v ON v.article_id = a.id
     WHERE a.is_deleted = 0
       AND a.status = 'published'
       AND a.updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
       AND COALESCE(v.views_30d, 0) = 0
     ORDER BY a.updated_at ASC
     LIMIT 50`,
    [zeroViewDays, zeroViewDays]
  );
  const lowSolveRows = await query(
    `SELECT
      a.id,
      a.title,
      COUNT(f.id) AS feedback_total,
      SUM(CASE WHEN f.solved = 1 THEN 1 ELSE 0 END) AS solved_total,
      SUM(CASE WHEN f.solved = 0 THEN 1 ELSE 0 END) AS unsolved_total
     FROM faq_articles a
     JOIN faq_article_feedback f ON f.article_id = a.id
     WHERE a.is_deleted = 0
     GROUP BY a.id, a.title
     HAVING COUNT(f.id) >= 3
       AND (SUM(CASE WHEN f.solved = 1 THEN 1 ELSE 0 END) / COUNT(f.id)) < 0.6
     ORDER BY unsolved_total DESC, feedback_total DESC
     LIMIT 50`
  );
  const recycleSoonRows = await query(
    `SELECT id, title, purge_after
     FROM faq_articles
     WHERE is_deleted = 1
       AND purge_after IS NOT NULL
       AND purge_after <= DATE_ADD(NOW(), INTERVAL ? DAY)
     ORDER BY purge_after ASC
     LIMIT 50`,
    [recycleWarnDays]
  );

  res.json({
    stale_days: staleDays,
    zero_view_days: zeroViewDays,
    recycle_warn_days: recycleWarnDays,
    summary: {
      stale_count: staleRows.length,
      low_solve_count: lowSolveRows.length,
      zero_view_count: zeroViewRows.length,
      recycle_soon_count: recycleSoonRows.length,
    },
    stale_articles: staleRows,
    low_solve_articles: lowSolveRows.map((item) => {
      const total = Number(item.feedback_total || 0);
      const solved = Number(item.solved_total || 0);
      return {
        ...item,
        feedback_total: total,
        solved_total: solved,
        unsolved_total: Number(item.unsolved_total || 0),
        solved_rate: total > 0 ? Number((solved / total).toFixed(4)) : 0,
      };
    }),
    zero_view_articles: zeroViewRows,
    recycle_soon_articles: recycleSoonRows,
  });
}));

app.get('/api/faq/pin/recommendations', requireWriter, asyncHandler(async (req, res) => {
  const limit = Math.max(3, Math.min(20, toPositiveInt(req.query.limit, SMART_PIN_TOPN)));
  const candidates = await buildSmartPinCandidates({ limit });
  res.json({
    generated_at: formatDateTime(new Date()),
    candidates,
  });
}));

app.post('/api/faq/pin/recommendations/apply', requireAdmin, asyncHandler(async (req, res) => {
  const top = Math.max(3, Math.min(20, toPositiveInt(req.body?.top, SMART_PIN_TOPN)));
  const result = await applySmartPins({ req, top });
  await logOperation({
    req,
    action: 'SMART_PIN_APPLY',
    message: `应用智能置顶，数量 ${result.applied}`,
    afterData: {
      top,
      applied: result.applied,
      candidates: result.candidates,
    },
  });
  res.json({
    ok: true,
    top,
    ...result,
  });
}));

app.get('/api/faq/logs', requireAuditor, asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 20);
  const offset = (page - 1) * limit;

  const keyword = trimText(req.query.keyword);
  const where = [];
  const params = [];

  if (keyword) {
    where.push('(action LIKE ? OR message LIKE ? OR operator_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await get(
    `SELECT COUNT(1) AS total
     FROM faq_operation_logs
     ${whereSql}`,
    params
  );

  const rows = await query(
    `SELECT *
     FROM faq_operation_logs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: rows,
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.get('/api/faq/events/outbox', requireAuditor, asyncHandler(async (req, res) => {
  const limit = Math.max(10, Math.min(200, toBoundedLimit(req.query.limit, 50)));
  const rows = await query(
    `SELECT id, target_system, event_type, article_id, delivery_status, delivery_attempts, last_error, delivered_at, next_retry_at, created_at, updated_at
     FROM faq_event_outbox
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );
  res.json(rows);
}));

app.get('/api/faq/publish-requests', requireReviewer, asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = Math.min(100, toBoundedLimit(req.query.limit, 20));
  const offset = (page - 1) * limit;
  const statusFilter = trimText(req.query.status).toLowerCase();
  const where = [];
  const params = [];
  if (statusFilter) {
    where.push('r.status = ?');
    params.push(statusFilter);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await get(
    `SELECT COUNT(1) AS total
     FROM faq_publish_requests r
     ${whereSql}`,
    params
  );
  const items = await query(
    `SELECT
      r.*,
      a.title AS article_title,
      v.version_no
     FROM faq_publish_requests r
     JOIN faq_articles a ON a.id = r.article_id
     LEFT JOIN faq_article_versions v ON v.id = r.target_version_id
     ${whereSql}
     ORDER BY r.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items,
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.post('/api/faq/publish-requests/:requestId/review', requireReviewer, asyncHandler(async (req, res) => {
  const requestId = Number(req.params.requestId);
  if (!Number.isFinite(requestId) || requestId <= 0) throw appError('审批单ID无效', 400);

  const reviewAction = trimText(req.body?.action).toLowerCase();
  if (!['approve', 'reject'].includes(reviewAction)) throw appError('审批动作仅支持 approve/reject', 400);
  const reviewComment = trimText(req.body?.comment).slice(0, 500) || null;

  const requestRow = await get('SELECT * FROM faq_publish_requests WHERE id = ? LIMIT 1', [requestId]);
  if (!requestRow) throw appError('审批单不存在', 404);
  if (trimText(requestRow.status) !== 'pending') throw appError('该审批单已处理，请刷新后重试', 409);

  if (reviewAction === 'reject') {
    await run(
      `UPDATE faq_publish_requests
       SET status = 'rejected',
           reviewer_id = ?,
           reviewer_name = ?,
           review_comment = ?,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [Number(req.user.id) || null, req.user.username, reviewComment, requestId]
    );
    await logOperation({
      req,
      articleId: Number(requestRow.article_id),
      action: 'PUBLISH_REQUEST_REJECT',
      message: `拒绝发布审批单 #${requestId}`,
      afterData: {
        request_id: requestId,
        review_comment: reviewComment,
      },
    });
    await emitSystemEvent({
      req,
      eventType: 'FAQ_PUBLISH_REJECTED',
      articleId: Number(requestRow.article_id),
      payload: {
        request_id: requestId,
        reviewer_name: req.user.username,
        review_comment: reviewComment,
      },
    });
    const afterReject = await get('SELECT * FROM faq_publish_requests WHERE id = ?', [requestId]);
    return res.json({
      ok: true,
      action: 'reject',
      request: afterReject,
    });
  }

  const article = await ensureArticleExists(Number(requestRow.article_id));
  const targetVersion = await getVersionById({
    articleId: Number(requestRow.article_id),
    versionId: Number(requestRow.target_version_id),
  });
  if (!targetVersion) throw appError('审批单对应版本不存在', 409);

  const precheck = await buildPublishPrecheck({
    article,
    version: targetVersion,
    operatorUserId: Number(req.user.id),
  });
  if (!precheck.ok) {
    return res.status(409).json({
      error: '发布校验未通过',
      checks: precheck.checks,
      active_lock: precheck.active_lock,
    });
  }

  const published = await publishArticleVersion({
    article,
    version: targetVersion,
    req,
    publishNote: trimText(requestRow.publish_note),
    action: 'PUBLISH_REQUEST_APPROVE_PUBLISH',
  });
  await run(
    `UPDATE faq_publish_requests
     SET status = 'approved',
         reviewer_id = ?,
         reviewer_name = ?,
         review_comment = ?,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id) || null, req.user.username, reviewComment, requestId]
  );
  await run(
    `UPDATE faq_publish_requests
     SET status = 'cancelled',
         reviewer_id = ?,
         reviewer_name = ?,
         review_comment = COALESCE(review_comment, '同文章其他待审单已自动关闭'),
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE article_id = ?
       AND status = 'pending'
       AND id <> ?`,
    [Number(req.user.id) || null, req.user.username, Number(requestRow.article_id), requestId]
  );
  await logOperation({
    req,
    articleId: Number(requestRow.article_id),
    action: 'PUBLISH_REQUEST_APPROVE',
    message: `通过发布审批单 #${requestId}`,
    afterData: {
      request_id: requestId,
      published_version_id: Number(targetVersion.id),
      review_comment: reviewComment,
    },
  });
  await emitSystemEvent({
    req,
    eventType: 'FAQ_PUBLISH_APPROVED',
    articleId: Number(requestRow.article_id),
    payload: {
      request_id: requestId,
      reviewer_name: req.user.username,
      published_version_id: Number(targetVersion.id),
      published_version_no: Number(targetVersion.version_no) || null,
      review_comment: reviewComment,
    },
  });

  const afterApprove = await get('SELECT * FROM faq_publish_requests WHERE id = ?', [requestId]);
  return res.json({
    ok: true,
    action: 'approve',
    request: afterApprove,
    article: published.article,
    version: published.version,
  });
}));

app.post('/api/faq/recycle/purge', requireAdmin, asyncHandler(async (_req, res) => {
  const purged = await purgeExpiredDeletedArticles();
  res.json({ ok: true, purged });
}));

app.post('/api/faq/reindex/search-text', requireAdmin, asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(2000, toPositiveInt(req.body?.limit, 300)));
  const articleId = Number(req.body?.article_id);
  const result = await reindexMissingSearchText({
    limit,
    articleId: Number.isFinite(articleId) && articleId > 0 ? articleId : null,
  });
  res.json({
    ok: true,
    ...result,
  });
}));

app.get('/api/faq/articles/:id/editor/status', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureManageableArticle(req, articleId);

  await expireArticleSessions(articleId);
  const activeSessions = await listActiveSessions(articleId);
  const ownActive = await getOwnActiveSession(articleId, Number(req.user.id) || 0);
  const visibleActive = ownActive || activeSessions[0] || null;
  const draft = await get('SELECT * FROM faq_article_drafts WHERE article_id = ?', [articleId]);
  const sections = await getSectionLocks(articleId);
  const now = Date.now();
  const expiresAt = parseDate(visibleActive?.expires_at);
  const remainingSeconds = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000)) : 0;

  res.json({
    active: visibleActive,
    own_active: ownActive,
    active_sessions: activeSessions,
    draft,
    editable: !!draft,
    collab_mode: EDITOR_COLLAB_MODE === 'section' ? 'section' : 'single',
    sections,
    server_time: formatDateTime(new Date()),
    lock: visibleActive
      ? {
          owner_id: Number(visibleActive.lock_owner_id) || null,
          owner_name: trimText(visibleActive.lock_owner_name) || '-',
          expires_at: visibleActive.expires_at,
          remaining_seconds: remainingSeconds,
          last_saved_at: visibleActive.last_saved_at || null,
          status: 'active',
        }
      : null,
  });
}));

app.get('/api/faq/articles/:id/editor/sections', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureManageableArticle(req, articleId);
  const sections = await getSectionLocks(articleId);
  res.json({
    collab_mode: EDITOR_COLLAB_MODE === 'section' ? 'section' : 'single',
    sections,
  });
}));

app.post('/api/faq/articles/:id/editor/sections/lock', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureManageableArticle(req, articleId);
  if (EDITOR_COLLAB_MODE !== 'section') throw appError('当前未开启分段协作模式', 409);

  const sectionKey = normalizeSectionKey(req.body?.section_key);
  const sectionName = trimText(req.body?.section_name);
  if (!sectionKey) throw appError('请选择分段', 400);
  await acquireSectionLock({
    articleId,
    sectionKey,
    sectionName,
    req,
  });
  await logOperation({
    req,
    articleId,
    action: 'EDITOR_SECTION_LOCK',
    message: `锁定分段 ${sectionKey}`,
  });
  const sections = await getSectionLocks(articleId);
  res.json({ ok: true, sections });
}));

app.post('/api/faq/articles/:id/editor/sections/release', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);
  await ensureManageableArticle(req, articleId);
  const sectionKey = normalizeSectionKey(req.body?.section_key);
  if (!sectionKey) throw appError('请选择分段', 400);
  const released = await releaseSectionLock({
    articleId,
    sectionKey,
    req,
  });
  await logOperation({
    req,
    articleId,
    action: 'EDITOR_SECTION_RELEASE',
    message: released ? `释放分段 ${sectionKey}` : `分段 ${sectionKey} 无活动锁`,
  });
  const sections = await getSectionLocks(articleId);
  res.json({
    ok: true,
    released,
    sections,
  });
}));

app.post('/api/faq/articles/:id/editor/session', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  const { article } = await ensureManageableArticle(req, articleId);
  const currentVersion = await getCurrentVersion(article);
  if (!currentVersion) throw appError('当前文章没有可编辑版本', 400);

  const sourceExt = `.${trimText(currentVersion.source_ext).toLowerCase()}`;
  if (sourceExt === '.pdf') throw appError('PDF 版本不支持在线编辑', 409);

  let editableSource = trimText(currentVersion.editable_file_path) || trimText(currentVersion.storage_path);
  if (sourceExt === '.doc' && !trimText(currentVersion.editable_file_path)) {
    const convertedDocx = await runLibreOfficeConvert(currentVersion.storage_path, EDITABLE_ROOT, 'docx');
    let managedEditable = null;
    try {
      managedEditable = await copyToManagedPath(convertedDocx, EDITABLE_ROOT, '.docx');
    } finally {
      await deleteFileSafe(convertedDocx);
    }
    await run('UPDATE faq_article_versions SET editable_file_path = ? WHERE id = ?', [managedEditable, Number(currentVersion.id)]);
    editableSource = managedEditable;
  }

  await expireArticleSessions(articleId);
  let existing = null;
  if (EDITOR_COLLAB_MODE === 'single') {
    existing = await getActiveSession(articleId);
    if (existing && Number(existing.lock_owner_id) !== Number(req.user.id)) {
      return res.status(409).json({
        error: '文章已被他人锁定',
        lock: existing,
      });
    }
  } else {
    existing = await getOwnActiveSession(articleId, Number(req.user.id) || 0);
  }

  if (!editableSource) throw appError('缺少可编辑源文件', 409);
  const sourceStat = await readFileStatSafe(editableSource);
  if (!sourceStat?.isFile()) throw appError('可编辑源文件不存在', 404);

  let draft = await get('SELECT * FROM faq_article_drafts WHERE article_id = ?', [articleId]);
  if (!draft) {
    const draftPath = await copyToManagedPath(editableSource, DRAFT_ROOT, '.docx');
    const insert = await run(
      `INSERT INTO faq_article_drafts
        (article_id, base_version_id, draft_file_path, draft_file_name, draft_ext, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, 'docx', ?, ?)`,
      [
        articleId,
        Number(currentVersion.id),
        draftPath,
        `${trimText(article.title) || 'faq'}-draft.docx`,
        Number(req.user.id) || null,
        req.user.username,
      ]
    );
    draft = await get('SELECT * FROM faq_article_drafts WHERE id = ?', [insert.insertId]);
  } else {
    const draftStat = await readFileStatSafe(draft.draft_file_path);
    const shouldRebuildDraft =
      Number(draft.base_version_id || 0) !== Number(currentVersion.id) ||
      !draftStat ||
      !draftStat.isFile();

    if (shouldRebuildDraft) {
      const draftPath = await copyToManagedPath(editableSource, DRAFT_ROOT, '.docx');
      await run(
        `UPDATE faq_article_drafts
         SET base_version_id = ?, draft_file_path = ?, draft_file_name = ?, draft_ext = 'docx',
             updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          Number(currentVersion.id),
          draftPath,
          `${trimText(article.title) || 'faq'}-draft.docx`,
          Number(req.user.id) || null,
          req.user.username,
          Number(draft.id),
        ]
      );
      draft = await get('SELECT * FROM faq_article_drafts WHERE id = ?', [Number(draft.id)]);
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EDITOR_LOCK_MINUTES * 60 * 1000);
  const sessionKey = existing?.session_key || crypto.randomUUID().replace(/-/g, '');
  const callbackToken = existing?.callback_token || crypto.randomBytes(24).toString('hex');

  if (existing) {
    await run(
      `UPDATE faq_editor_sessions
       SET draft_id = ?, version_id = ?, lock_owner_id = ?, lock_owner_name = ?, status = 'active',
           expires_at = ?, callback_token = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        Number(draft.id),
        Number(currentVersion.id),
        Number(req.user.id),
        req.user.username,
        formatDateTime(expiresAt),
        callbackToken,
        Number(existing.id),
      ]
    );
  } else {
    await run(
      `INSERT INTO faq_editor_sessions
        (session_key, article_id, version_id, draft_id, lock_owner_id, lock_owner_name, status, expires_at, callback_token)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        sessionKey,
        articleId,
        Number(currentVersion.id),
        Number(draft.id),
        Number(req.user.id),
        req.user.username,
        formatDateTime(expiresAt),
        callbackToken,
      ]
    );
  }

  const session = await get('SELECT * FROM faq_editor_sessions WHERE session_key = ?', [sessionKey]);

  const draftToken = jwt.sign(
    {
      type: 'faq_draft',
      sessionKey,
      draftId: Number(draft.id),
    },
    DOC_EDITOR_JWT_SECRET,
    {
      expiresIn: `${EDITOR_LOCK_MINUTES}m`,
    }
  );

  const editableUrl = `${DOC_EDITOR_FILE_BASE_URL}/api/faq/drafts/${draft.id}/download.docx?token=${encodeURIComponent(draftToken)}`;
  const callbackUrl = `${DOC_EDITOR_CALLBACK_BASE_URL}/api/faq/editor/callback/${sessionKey}?token=${encodeURIComponent(callbackToken)}`;

  const editor = buildOnlyOfficeConfig({
    session,
    article,
    draft,
    editableUrl,
    callbackUrl,
  });

  await logOperation({
    req,
    articleId,
    action: 'EDITOR_SESSION_CREATE',
    message: '创建在线编辑会话',
    afterData: {
      session_key: sessionKey,
      draft_id: draft.id,
      expires_at: session.expires_at,
    },
  });

  debugDocEditor('editor_session_created', {
    article_id: articleId,
    session_key: sessionKey,
    draft_id: Number(draft.id),
    current_version_id: Number(currentVersion.id),
    editable_url: editableUrl,
    callback_url: callbackUrl,
  });

  res.json({
    provider: DOC_EDITOR_PROVIDER,
    session,
    draft,
    editor,
    collab_mode: EDITOR_COLLAB_MODE === 'section' ? 'section' : 'single',
    sections: await getSectionLocks(articleId),
  });
}));

app.post('/api/faq/articles/:id/editor/release', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  await ensureManageableArticle(req, articleId);
  await expireArticleSessions(articleId);
  let active = await getOwnActiveSession(articleId, Number(req.user.id) || 0);
  if (!active && EDITOR_COLLAB_MODE === 'single') {
    const visible = await getActiveSession(articleId);
    if (visible && Number(visible.lock_owner_id) !== Number(req.user.id)) {
      throw appError('该编辑锁不属于当前用户', 403);
    }
    active = visible;
  }

  if (active) {
    await run(
      `UPDATE faq_editor_sessions
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [Number(active.id)]
    );
  }
  await run(
    `UPDATE faq_editor_section_locks
     SET status = 'released', released_at = NOW(), updated_at = NOW()
     WHERE article_id = ? AND lock_owner_id = ? AND status = 'active'`,
    [articleId, Number(req.user.id) || 0]
  );

  await logOperation({ req, articleId, action: 'EDITOR_SESSION_RELEASE', message: '释放在线编辑锁' });
  res.json({ ok: true });
}));

app.post('/api/faq/articles/:id/editor/publish', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  const { article } = await ensureManageableArticle(req, articleId);
  const publishNote = normalizePublishNote(req.body?.publish_note);
  await expireArticleSessions(articleId);
  let active = await getOwnActiveSession(articleId, Number(req.user.id) || 0);
  if (!active && EDITOR_COLLAB_MODE === 'single') {
    active = await getActiveSession(articleId);
  }
  if (!active) throw appError('未找到有效编辑会话', 409);
  if (Number(active.lock_owner_id) !== Number(req.user.id)) throw appError('该编辑会话不属于当前用户', 403);

  const draft = await get('SELECT * FROM faq_article_drafts WHERE id = ? AND article_id = ?', [Number(active.draft_id), articleId]);
  if (!draft) throw appError('草稿不存在', 404);

  const stat = await readFileStatSafe(draft.draft_file_path);
  if (!stat?.isFile()) throw appError('草稿文件不存在', 404);
  const searchText = await extractDocxSearchText(draft.draft_file_path);

  const published = await transaction(async (tx) => {
    const nextVersionNo = await getNextVersionNo(tx, articleId);

    const storedPath = await copyToManagedPath(draft.draft_file_path, UPLOAD_ROOT, '.docx');
    const editablePath = await copyToManagedPath(draft.draft_file_path, EDITABLE_ROOT, '.docx');
    const previewPath = path.join(PREVIEW_ROOT, buildStoredFilename(path.basename(draft.draft_file_name || ''), '.html'));
    await convertDocxToHtml(draft.draft_file_path, previewPath, article.title);

    await tx.run('UPDATE faq_article_versions SET is_published_version = 0 WHERE article_id = ?', [articleId]);

    const insert = await tx.run(
      `INSERT INTO faq_article_versions
        (article_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type,
         editable_file_path, preview_file_path, render_type, render_status, render_error, search_text, is_published_version,
         publish_note, parent_version_id, created_by_id, created_by_name)
       VALUES (?, ?, 'online_edit', 'docx', ?, ?, ?, ?, ?, ?, 'onlyoffice_docx', 'ready', NULL, ?, 1, ?, ?, ?, ?)`,
      [
        articleId,
        nextVersionNo,
        storedPath,
        `${trimText(article.title) || 'faq'}-v${nextVersionNo}.docx`,
        Number(stat.size || 0),
        guessMimeByExt('.docx'),
        editablePath,
        previewPath,
        searchText,
        publishNote || null,
        Number(article.current_version_id) || null,
        Number(req.user.id) || null,
        req.user.username,
      ]
    );

    await tx.run(
      `UPDATE faq_articles
       SET current_version_id = ?,
           published_version_id = ?,
           status = 'published',
           published_by_id = ?,
           published_by_name = ?,
           published_at = NOW(),
           updated_by_id = ?,
           updated_by_name = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        insert.insertId,
        insert.insertId,
        Number(req.user.id) || null,
        req.user.username,
        Number(req.user.id) || null,
        req.user.username,
        articleId,
      ]
    );

    await tx.run(
      `UPDATE faq_editor_sessions
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [Number(active.id)]
    );
    await tx.run(
      `UPDATE faq_editor_section_locks
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE article_id = ? AND lock_owner_id = ? AND status = 'active'`,
      [articleId, Number(req.user.id) || 0]
    );

    return tx.get('SELECT * FROM faq_article_versions WHERE id = ?', [insert.insertId]);
  });

  await logOperation({
    req,
    articleId,
    action: 'EDITOR_PUBLISH',
    message: `在线编辑发布版本 ${published.version_no}`,
    afterData: {
      version_id: published.id,
      version_no: published.version_no,
      render_type: published.render_type,
      publish_note: publishNote || null,
    },
  });
  await emitSystemEvent({
    req,
    eventType: 'FAQ_EDITOR_PUBLISHED',
    articleId,
    payload: {
      article_title: trimText(article.title),
      version_no: Number(published.version_no) || null,
      publish_note: publishNote || null,
    },
  });

  res.status(201).json(published);
}));

app.post('/api/faq/articles/:id/editor/discard', asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw appError('文章ID无效', 400);

  await ensureManageableArticle(req, articleId);
  await expireArticleSessions(articleId);
  let active = await getOwnActiveSession(articleId, Number(req.user.id) || 0);
  if (!active && EDITOR_COLLAB_MODE === 'single') {
    active = await getActiveSession(articleId);
  }
  if (active && Number(active.lock_owner_id) !== Number(req.user.id)) {
    throw appError('该编辑锁不属于当前用户', 403);
  }
  const activeSessions = await listActiveSessions(articleId);
  const hasOtherCollaborators = activeSessions.some((item) => Number(item.lock_owner_id || 0) !== Number(req.user.id));
  if (EDITOR_COLLAB_MODE === 'section' && hasOtherCollaborators && !isAdmin(req)) {
    throw appError('仍有其他协作者在线编辑，请先结束协作后再放弃草稿', 409);
  }

  const draft = await get('SELECT * FROM faq_article_drafts WHERE article_id = ?', [articleId]);
  if (draft) {
    try {
      await fs.promises.unlink(draft.draft_file_path);
    } catch {
      // ignore file cleanup error
    }
    await run('DELETE FROM faq_article_drafts WHERE id = ?', [Number(draft.id)]);
  }

  if (EDITOR_COLLAB_MODE === 'section') {
    await run(
      `UPDATE faq_editor_sessions
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE article_id = ? AND status = 'active' AND lock_owner_id = ?`,
      [articleId, Number(req.user.id) || 0]
    );
  } else {
    await run(
      `UPDATE faq_editor_sessions
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE article_id = ? AND status = 'active'`,
      [articleId]
    );
  }
  await run(
    `UPDATE faq_editor_section_locks
     SET status = 'released', released_at = NOW(), updated_at = NOW()
     WHERE article_id = ? AND lock_owner_id = ? AND status = 'active'`,
    [articleId, Number(req.user.id) || 0]
  );

  await logOperation({ req, articleId, action: 'EDITOR_DISCARD', message: '放弃在线编辑草稿' });
  res.json({ ok: true });
}));

app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode || err?.status || 500);
  const message = trimText(err?.message) || '服务器内部错误';
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

let recycleCleanupTimer = null;
let eventOutboxTimer = null;
let smartPinTimer = null;

const start = async () => {
  validateSecurityBootstrap();
  await initDb();
  try {
    let rounds = 0;
    let totalUpdated = 0;
    while (rounds < 20) {
      const result = await reindexMissingSearchText({ limit: 200 });
      rounds += 1;
      totalUpdated += Number(result.updated || 0);
      if (Number(result.scanned || 0) === 0) break;
      if (Number(result.updated || 0) === 0) break;
    }
    if (totalUpdated > 0) {
      console.log(`[faq] search_text reindex completed, updated=${totalUpdated}`);
    }
  } catch (err) {
    console.error('[faq] search_text reindex failed:', err?.message || err);
  }
  try {
    const purged = await purgeExpiredDeletedArticles();
    if (purged > 0) {
      console.log(`[faq] recycle initial purge completed, purged=${purged}`);
    }
  } catch (err) {
    console.error('[faq] recycle initial purge failed:', err?.message || err);
  }
  try {
    const flushed = await flushPendingSystemEvents(30);
    if (Number(flushed.sent || 0) > 0 || Number(flushed.failed || 0) > 0) {
      console.log(`[faq] outbox initial flush scanned=${flushed.scanned} sent=${flushed.sent} failed=${flushed.failed}`);
    }
  } catch (err) {
    console.error('[faq] outbox initial flush failed:', err?.message || err);
  }
  try {
    const pinResult = await applySmartPins({ top: SMART_PIN_TOPN });
    if (Number(pinResult.applied || 0) > 0) {
      console.log(`[faq] smart pin initial refresh applied=${pinResult.applied}`);
    }
  } catch (err) {
    console.error('[faq] smart pin initial refresh failed:', err?.message || err);
  }

  recycleCleanupTimer = setInterval(() => {
    purgeExpiredDeletedArticles().catch((err) => {
      console.error('[faq] recycle scheduled purge failed:', err?.message || err);
    });
  }, RECYCLE_CLEANUP_INTERVAL_MS);
  if (typeof recycleCleanupTimer.unref === 'function') recycleCleanupTimer.unref();
  eventOutboxTimer = setInterval(() => {
    flushPendingSystemEvents(20).catch((err) => {
      console.error('[faq] outbox scheduled flush failed:', err?.message || err);
    });
  }, EVENT_OUTBOX_FLUSH_INTERVAL_MS);
  if (typeof eventOutboxTimer.unref === 'function') eventOutboxTimer.unref();
  smartPinTimer = setInterval(() => {
    applySmartPins({ top: SMART_PIN_TOPN }).catch((err) => {
      console.error('[faq] smart pin scheduled refresh failed:', err?.message || err);
    });
  }, SMART_PIN_REFRESH_INTERVAL_MS);
  if (typeof smartPinTimer.unref === 'function') smartPinTimer.unref();

  app.listen(PORT, () => {
    console.log(`FAQ API running at http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  console.error('[faq] failed to start:', err);
  process.exit(1);
});

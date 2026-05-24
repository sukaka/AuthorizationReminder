require('dotenv').config();

const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
const express = require('express');
const fs = require('fs');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const mysql = require('mysql2/promise');
const net = require('net');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { get, initDb, query, run, transaction } = require('./db');
const {
  buildManagedOssObjectKey,
  createManagedOssPlaybackUrl,
  createManagedOssUploadSignature,
  createOssClient,
  headManagedOssObject,
  readOssConfigFromEnv,
  validateOssConfig,
} = require('./oss-utils');
const {
  OSS_SYSTEM_SETTING_KEYS,
  buildManagedOssAdminPayload,
  normalizeManagedOssSettingsInput,
  resolveManagedOssConfig,
  serializeManagedOssSettings,
  summarizeManagedOssConfig,
} = require('./oss-settings-utils');
const {
  ALLOWED_STORAGE_BACKENDS,
  normalizeStorageBackend,
  normalizeUploadStatus,
  resolveStorageBackend,
  supportsManagedVideoPlayback,
} = require('./resource-storage-utils');
const {
  isProgressCompleted,
  shouldEnforceManagedVideoForceWatch,
} = require('./learning-progress-utils');
const {
  SCHEDULED_PAPER_STATUS,
  normalizeScheduledPublishAt,
} = require('./paper-schedule-utils');
const {
  buildQuestionImportTemplateRows,
  normalizeJudgementAnswer,
  resolveImportQuestionStatus,
} = require('./question-import-utils');
const { buildQuestionFilterWhere } = require('./question-filter-utils');
const { normalizeQuestionCategoryRow } = require('./question-category-utils');
const { normalizePaperRuleCategories } = require('./paper-rule-utils');
const {
  buildResultsExportCsv,
  normalizeAdminResultsFilters,
  buildAdminResultsWhere,
  normalizeAdminResultListRow,
  normalizeAdminResultPaperSummaryRow,
  normalizeAdminResultsSummary,
  buildResultReviewDetail,
  buildCandidateHistorySummary,
  buildOverallEvaluation,
} = require('./result-center-utils');
const {
  buildInstructorReviewQuestionnaireSummary,
  normalizeInstructorQuestionnaireInput,
  normalizeInstructorReviewResponseInput,
  normalizeInstructorReviewStatus,
} = require('./instructor-review-utils');
const {
  canReadCourse,
  createMemoryRateLimiter,
  isDocPreviewHostAllowed,
  validateAiBaseUrl,
} = require('./security-utils');
const {
  evaluateAnswer,
  normalizeMultipleChoiceAnswerValues,
} = require('./exam-answer-utils');
const {
  getExamSessionExpireTs,
  shouldResumeExistingExamSession,
} = require('./exam-session-utils');
const {
  resolveRetakeStartPermission,
  shouldKeepFinalResultAfterDelete,
} = require('./retake-opportunity-utils');
const { isBasicViewerApiAllowed, isBasicViewerRole } = require('./viewer-scope-utils');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');

const app = express();

const PORT = Number(process.env.PORT || 5188);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'train-exam').trim() || 'train-exam';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));
const SECURITY_STRICT_MODE = process.env.SECURITY_STRICT_MODE === 'true' || process.env.NODE_ENV === 'production';
const CSRF_COOKIE_NAME = String(process.env.TRAIN_EXAM_CSRF_COOKIE_NAME || 'train_exam_csrf_token').trim() || 'train_exam_csrf_token';
const CSRF_SECURE = process.env.CSRF_SECURE === 'true';
const AUDIT_SIGNING_KEY = String(process.env.AUDIT_SIGNING_KEY || 'train-exam-audit-signing-key-change-me').trim();
const AI_ALLOW_PRIVATE_BASE_URLS = process.env.AI_ALLOW_PRIVATE_BASE_URLS === 'true';
const AI_ALLOW_INSECURE_HTTP = process.env.AI_ALLOW_INSECURE_HTTP === 'true';

const FILE_MAX_BYTES = Math.max(1024 * 100, Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 50) * 1024 * 1024);
const VIDEO_TRANSCODE_ENABLED = String(process.env.VIDEO_TRANSCODE_ENABLED || 'true').trim().toLowerCase() !== 'false';
const VIDEO_TRANSCODE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.VIDEO_TRANSCODE_TIMEOUT_MS || 1800000);
  if (!Number.isFinite(raw)) return 1800000;
  return Math.max(60000, Math.min(raw, 4 * 60 * 60 * 1000));
})();
const VIDEO_TRANSCODE_PRESET = String(process.env.VIDEO_TRANSCODE_PRESET || 'veryfast').trim() || 'veryfast';
const VIDEO_TRANSCODE_CRF = (() => {
  const raw = Number(process.env.VIDEO_TRANSCODE_CRF || 23);
  if (!Number.isFinite(raw)) return 23;
  return Math.max(18, Math.min(35, Math.round(raw)));
})();
const RESOURCE_ROOT = path.resolve(process.env.RESOURCE_ROOT || '/data/train-exam/resources');
const IMPORT_ROOT = path.resolve(process.env.IMPORT_ROOT || '/data/train-exam/imports');
const CERT_ROOT = path.resolve(process.env.CERT_ROOT || '/data/train-exam/certificates');
const CERT_TEMPLATE_DIR = path.resolve(process.env.CERT_TEMPLATE_DIR || path.join(CERT_ROOT, 'templates'));
const RESOURCE_TMP_ROOT = path.resolve(process.env.RESOURCE_TMP_ROOT || '/tmp/train-exam-resource-upload');

const FAQ_MYSQL_HOST = process.env.FAQ_MYSQL_HOST || process.env.MYSQL_HOST || '127.0.0.1';
const FAQ_MYSQL_PORT = Number(process.env.FAQ_MYSQL_PORT || process.env.MYSQL_PORT || 3306);
const FAQ_MYSQL_USER = process.env.FAQ_MYSQL_USER || process.env.MYSQL_ADMIN_USER || process.env.MYSQL_USER || 'root';
const FAQ_MYSQL_PASSWORD =
  process.env.FAQ_MYSQL_PASSWORD !== undefined
    ? process.env.FAQ_MYSQL_PASSWORD
    : process.env.MYSQL_ADMIN_PASSWORD !== undefined
      ? process.env.MYSQL_ADMIN_PASSWORD
      : process.env.MYSQL_PASSWORD || '';
const FAQ_MYSQL_DATABASE = process.env.FAQ_MYSQL_DATABASE || 'juxin_faq';

const LIST_MAX_LIMIT = Math.max(20, Math.min(500, Number(process.env.TRAIN_EXAM_LIST_MAX_LIMIT || 200)));
const QUESTION_IMPORT_MAX_ROWS = Math.max(20, Math.min(2000, Number(process.env.TRAIN_EXAM_IMPORT_MAX_ROWS || 1000)));
const QUESTION_GENERATION_MAX_SOURCES = Math.max(10, Math.min(500, Number(process.env.TRAIN_EXAM_GENERATION_MAX_SOURCES || 120)));
const CERT_VALIDITY_DAYS_DEFAULT = Math.max(30, Math.min(3650, Number(process.env.CERT_VALIDITY_DAYS || 365)));
const CERT_RENEWAL_REMIND_DAYS_DEFAULT = Math.max(1, Math.min(365, Number(process.env.CERT_RENEWAL_REMIND_DAYS || 30)));
const DOC_EDITOR_PROVIDER = String(process.env.DOC_EDITOR_PROVIDER || 'onlyoffice').trim() || 'onlyoffice';
const DOC_EDITOR_FILE_BASE_URL = String(process.env.DOC_EDITOR_FILE_BASE_URL || 'http://train-exam-api:5188').trim().replace(/\/+$/, '');
const DOC_EDITOR_PUBLIC_PATH = String(process.env.DOC_EDITOR_PUBLIC_PATH || '/doc-editor').trim() || '/doc-editor';
const DOC_EDITOR_JWT_SECRET = String(process.env.DOC_EDITOR_JWT_SECRET || 'faq-onlyoffice-jwt-change-me').trim();
const DOC_EDITOR_FILE_ALLOWED_HOST = (() => {
  try {
    return new URL(DOC_EDITOR_FILE_BASE_URL).host.toLowerCase();
  } catch {
    return '';
  }
})();
const DOC_PREVIEW_MIN_SECONDS_MIN = 15;
const DOC_PREVIEW_MIN_SECONDS_MAX = 600;
const DOC_PREVIEW_MIN_SECONDS_DEFAULT = Math.max(
  DOC_PREVIEW_MIN_SECONDS_MIN,
  Math.min(DOC_PREVIEW_MIN_SECONDS_MAX, Number(process.env.DOC_PREVIEW_MIN_SECONDS || 45))
);
const DOC_PREVIEW_FILE_TOKEN_TTL_SECONDS = Math.max(60, Math.min(3600, Number(process.env.DOC_PREVIEW_FILE_TOKEN_TTL_SECONDS || 900)));

const SECRET_MASK = '******';
const ALLOWED_RESOURCE_TYPES = new Set(['doc', 'video', 'link']);
const ALLOWED_SOURCE_MODES = new Set(['upload', 'external']);
const ALLOWED_QUESTION_TYPES = new Set(['single_choice', 'multiple_choice', 'judgement', 'fill_blank']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const ALLOWED_JOB_STATUSES = new Set(['pending', 'running', 'completed', 'partial_failed', 'published', 'failed']);
const ALLOWED_COURSE_STATUSES = new Set(['draft', 'published', 'archived']);
const ALLOWED_PAPER_MODES = new Set(['fixed', 'random']);
const ALLOWED_PAPER_STATUSES = new Set(['draft', 'published', 'archived', SCHEDULED_PAPER_STATUS]);

const ALLOWED_DOC_EXTS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md']);
const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const ALLOWED_OSS_VIDEO_EXTS = new Set(['.mp4']);
const ALLOWED_OSS_VIDEO_MIME = new Set(['video/mp4']);

const ALLOWED_DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);
const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
]);
const ALLOWED_CERT_TEMPLATE_EXTS = new Set(['.png', '.jpg', '.jpeg']);
const ALLOWED_CERT_TEMPLATE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const TRANSCODE_ACTIVE_STATUSES = new Set(['queued', 'running']);
const TRANSCODE_DONE_STATUSES = new Set(['succeeded', 'failed', 'skipped']);
const VIDEO_MIME_BY_EXT = Object.freeze({
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
});
const DOC_MIME_BY_EXT = Object.freeze({
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
});
const QUESTION_TYPE_ALIASES = {
  single_choice: 'single_choice',
  single: 'single_choice',
  radio: 'single_choice',
  单选: 'single_choice',
  单选题: 'single_choice',
  multiple_choice: 'multiple_choice',
  multiple: 'multiple_choice',
  checkbox: 'multiple_choice',
  多选: 'multiple_choice',
  多选题: 'multiple_choice',
  judgement: 'judgement',
  judgment: 'judgement',
  true_false: 'judgement',
  判断: 'judgement',
  判断题: 'judgement',
  fill_blank: 'fill_blank',
  fill: 'fill_blank',
  blank: 'fill_blank',
  填空: 'fill_blank',
  填空题: 'fill_blank',
};

const DIFFICULTY_ALIASES = {
  easy: 'easy',
  简单: 'easy',
  medium: 'medium',
  中等: 'medium',
  hard: 'hard',
  困难: 'hard',
};

const PAPER_MODE_ALIASES = {
  fixed: 'fixed',
  固定: 'fixed',
  固定试卷: 'fixed',
  random: 'random',
  随机: 'random',
  随机试卷: 'random',
};

const RESOURCE_TYPE_ALIASES = {
  doc: 'doc',
  文档: 'doc',
  video: 'video',
  视频: 'video',
  link: 'link',
  外链: 'link',
};

const SOURCE_MODE_ALIASES = {
  upload: 'upload',
  上传: 'upload',
  external: 'external',
  外链: 'external',
};

let faqPool = null;
let transcodeRunnerActive = false;

const defaultOrigins = ['http://localhost:18087', 'http://127.0.0.1:18087'].map(normalizeOrigin);
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
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const getCsrfCookieValue = (req) => trimText(req.cookies?.[CSRF_COOKIE_NAME]);

const issueCsrfToken = (res) => {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: CSRF_SECURE,
    path: '/',
  });
  return token;
};

const validateCsrfToken = (req, _res, next) => {
  const cookieToken = getCsrfCookieValue(req);
  const headerToken = trimText(req.headers['x-csrf-token']);
  if (!cookieToken || !headerToken) {
    const err = appError('CSRF 校验失败，请刷新页面后重试', 403);
    err.securityAction = 'CSRF_FAILURE';
    return next(err);
  }
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (cookieBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
    const err = appError('CSRF 校验失败，请刷新页面后重试', 403);
    err.securityAction = 'CSRF_FAILURE';
    return next(err);
  }
  return next();
};

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/train-exam/csrf') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return validateCsrfToken(req, res, next);
});

for (const dir of [RESOURCE_ROOT, IMPORT_ROOT, CERT_ROOT, CERT_TEMPLATE_DIR, RESOURCE_TMP_ROOT]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const uploadLimited = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FILE_MAX_BYTES,
  },
});

const uploadResource = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RESOURCE_TMP_ROOT),
    filename: (_req, file, cb) => {
      const ext = path.extname(trimText(file?.originalname)).toLowerCase();
      const baseName = path.basename(trimText(file?.originalname) || `upload-${Date.now()}`, ext);
      const safeBaseName = String(baseName || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'file';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeBaseName}${ext}`);
    },
  }),
});

const trimText = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value).trim());

const weakSecrets = new Set([
  'change-me',
  'train-exam-audit-signing-key-change-me',
  'faq-onlyoffice-jwt-change-me',
  'password',
  '123456',
  '',
]);

const isWeakSecret = (value, minLength = 16) => {
  const text = trimText(value);
  if (!text) return true;
  if (text.length < minLength) return true;
  return weakSecrets.has(text.toLowerCase());
};

const validateSecurityBootstrap = () => {
  const problems = [];
  if (isWeakSecret(AUDIT_SIGNING_KEY, 32)) {
    problems.push('AUDIT_SIGNING_KEY 过弱（建议至少32位随机值）');
  }
  if (isWeakSecret(DOC_EDITOR_JWT_SECRET, 32)) {
    problems.push('DOC_EDITOR_JWT_SECRET 过弱（建议至少32位随机值）');
  }
  if (!DOC_EDITOR_FILE_ALLOWED_HOST) {
    problems.push('DOC_EDITOR_FILE_BASE_URL 非法，无法解析可信 Host');
  }
  if (!problems.length) return;
  const message = `[SECURITY][train-exam] ${problems.join('；')}`;
  if (SECURITY_STRICT_MODE) {
    throw new Error(message);
  }
  console.warn(`${message}。当前为非严格模式，仅告警。`);
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

const normalizeQuestionType = (value, fallback = 'single_choice') => {
  const raw = trimText(value);
  const key = raw.toLowerCase();
  const alias = QUESTION_TYPE_ALIASES[key] || QUESTION_TYPE_ALIASES[raw];
  if (alias) return alias;
  return ALLOWED_QUESTION_TYPES.has(key) ? key : fallback;
};

const normalizeDifficulty = (value, fallback = 'medium') => {
  const raw = trimText(value);
  const key = raw.toLowerCase();
  const alias = DIFFICULTY_ALIASES[key] || DIFFICULTY_ALIASES[raw];
  if (alias) return alias;
  return ALLOWED_DIFFICULTIES.has(key) ? key : fallback;
};

const normalizeCourseStatus = (value, fallback = 'draft') => {
  const key = trimText(value).toLowerCase();
  return ALLOWED_COURSE_STATUSES.has(key) ? key : fallback;
};

const normalizePaperMode = (value, fallback = 'fixed') => {
  const raw = trimText(value);
  const key = raw.toLowerCase();
  const alias = PAPER_MODE_ALIASES[key] || PAPER_MODE_ALIASES[raw];
  if (alias) return alias;
  return ALLOWED_PAPER_MODES.has(key) ? key : fallback;
};

const normalizePaperStatus = (value, fallback = 'draft') => {
  const key = trimText(value).toLowerCase();
  return ALLOWED_PAPER_STATUSES.has(key) ? key : fallback;
};

const toMysqlDatetime = (date) => {
  if (!(date instanceof Date)) return null;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseDate = (value) => {
  const text = trimText(value);
  if (!text) return null;
  const date = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return date;
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

const stableStringify = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

const maskSecret = (value) => (trimText(value) ? SECRET_MASK : '');

const appError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const buildManagedOssSettingsResponse = (config) => {
  const payload = buildManagedOssAdminPayload(config);
  if (!config?.enabled) {
    return {
      ...payload,
      configured: false,
      validation_error: '',
    };
  }
  try {
    validateOssConfig(config);
    return {
      ...payload,
      configured: true,
      validation_error: '',
    };
  } catch (err) {
    return {
      ...payload,
      configured: false,
      validation_error: trimText(err?.message || err) || '请联系管理员检查配置',
    };
  }
};

const getManagedOssRuntime = async () => {
  const rawConfig = resolveManagedOssConfig({
    envConfig: readOssConfigFromEnv(),
    settings: await getSystemSettingValues(Object.values(OSS_SYSTEM_SETTING_KEYS)),
  });
  if (!rawConfig.enabled) throw appError('阿里云 OSS 未启用，请联系管理员配置', 409);
  try {
    return createOssClient({ config: rawConfig });
  } catch (err) {
    throw appError(`阿里云 OSS 配置无效：${trimText(err?.message || err) || '请联系管理员检查配置'}`, 500);
  }
};

const ensureManagedOssVideoResource = (resource, statusCode = 400) => {
  if (!resource) throw appError('资源不存在', 404);
  const resourceType = normalizeResourceType(resource.resource_type);
  const sourceMode = normalizeSourceMode(resource.source_mode);
  const storageBackend = resolveStorageBackend({
    sourceMode,
    requested: resource.storage_backend,
    fallback: sourceMode === 'external' ? 'external' : 'local',
  });
  if (resourceType !== 'video' || sourceMode !== 'upload' || storageBackend !== 'oss') {
    throw appError('仅上传视频且存储后端为 OSS 的资源支持该操作', statusCode);
  }
  return {
    resourceType,
    sourceMode,
    storageBackend,
  };
};

const validateManagedOssUploadInput = ({ fileName, mimeType, fileSize, maxFileBytes }) => {
  const originalName = trimText(fileName);
  if (!originalName) throw appError('缺少文件名', 400);
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_OSS_VIDEO_EXTS.has(ext)) throw appError('OSS 视频目前仅支持标准 MP4 上传', 400);

  const normalizedMime = trimText(mimeType).toLowerCase() || 'video/mp4';
  if (!ALLOWED_OSS_VIDEO_MIME.has(normalizedMime)) throw appError('OSS 视频目前仅支持 video/mp4', 400);

  const size = Number(fileSize || 0);
  const sizeLimitBytes = Math.max(1, Number(maxFileBytes || 0));
  if (size > 0 && sizeLimitBytes > 0 && size > sizeLimitBytes) {
    throw appError(`视频文件过大，最大支持 ${Math.round(sizeLimitBytes / (1024 * 1024))}MB`, 413);
  }
  return {
    ext,
    mimeType: normalizedMime,
    fileSize: size > 0 ? size : null,
  };
};

const validateManagedOssHeadResult = ({ headResult, mimeType, fileSize }) => {
  const actualMimeType = trimText(headResult?.contentType).toLowerCase();
  if (actualMimeType && !actualMimeType.startsWith('video/mp4')) {
    throw appError('OSS 对象类型无效，当前仅支持 video/mp4', 400);
  }
  const expectedMimeType = trimText(mimeType).toLowerCase();
  if (expectedMimeType && actualMimeType && actualMimeType !== expectedMimeType) {
    throw appError('OSS 对象类型与申请上传时不一致', 400);
  }
  const actualSize = Number(headResult?.contentLength || 0) || 0;
  if (actualSize <= 0) throw appError('OSS 对象大小无效，请重新上传', 400);
  const expectedSize = Number(fileSize || 0);
  if (expectedSize > 0 && actualSize !== expectedSize) {
    throw appError('OSS 对象大小与上传声明不一致', 400);
  }
  return {
    contentLength: actualSize,
    contentType: actualMimeType || expectedMimeType || 'video/mp4',
    etag: trimText(headResult?.etag),
  };
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
  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) throw appError('无权限访问培训考试系统', 403);

  return {
    user: {
      id: Number(user.id),
      username: String(user.username || ''),
      role: trimText(user.role || 'viewer').toLowerCase() || 'viewer',
    },
    apps,
  };
};

const getUserRole = (req) => trimText(req.user?.role).toLowerCase();
const isAdmin = (req) => getUserRole(req) === 'admin';
const isEditor = (req) => getUserRole(req) === 'editor';
const isReviewer = (req) => getUserRole(req) === 'reviewer';
const isAuditor = (req) => getUserRole(req) === 'auditor';
const isViewer = (req) => isBasicViewerRole(getUserRole(req));
const canReadTrainExam = () => true;
const canWriteContent = (req) => isAdmin(req) || isEditor(req);
const canReviewQuestions = (req) => isAdmin(req) || isReviewer(req);
const canPublishPaper = (req) => isAdmin(req) || isReviewer(req);
const canReadAudit = (req) => isAuditor(req);
const canReadAiModelConfig = (req) => isAdmin(req);
const canReadResultCenter = (req) => isAdmin(req) || isReviewer(req) || isAuditor(req);
const isElevatedTrainExamReader = (req) => isAdmin(req) || isEditor(req) || isReviewer(req) || isAuditor(req);
const isBasicTrainExamUser = (req) =>
  isViewer(req)
  && !canWriteContent(req)
  && !canReviewQuestions(req)
  && !canPublishPaper(req)
  && !canReadAudit(req)
  && !canReadAiModelConfig(req);

const canReadCourseRecord = (req, course) => canReadCourse({
  role: getUserRole(req),
  courseStatus: trimText(course?.status),
});

const ensureCourseReadAccess = (req, course, message = '无权限访问该课程') => {
  if (!course) throw appError('课程不存在', 404);
  if (!canReadCourseRecord(req, course)) throw appError(message, 403);
  return course;
};

const buildCourseWhereForReader = (req, { alias = '' } = {}) => {
  if (isElevatedTrainExamReader(req)) {
    return { whereSql: '', params: [] };
  }
  const prefix = alias ? `${alias}.` : '';
  return {
    whereSql: `WHERE ${prefix}status = 'published'`,
    params: [],
  };
};

const allowBasicViewerApi = (req) => {
  const method = trimText(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return true;
  const fullPath = trimText(String(req.originalUrl || '').split('?')[0]);
  return isBasicViewerApiAllowed({ method, path: fullPath });
};

const requireReader = (req, _res, next) => {
  if (!canReadTrainExam(req)) return next(appError('无权限读取培训考试数据', 403));
  return next();
};

const requireContentWriter = (req, _res, next) => {
  if (!canWriteContent(req)) return next(appError('仅管理员或编辑可执行该操作', 403));
  return next();
};

const requireQuestionReviewer = (req, _res, next) => {
  if (!canReviewQuestions(req)) return next(appError('仅管理员或审核员可执行该操作', 403));
  return next();
};

const requirePaperPublisher = (req, _res, next) => {
  if (!canPublishPaper(req)) return next(appError('仅管理员或审核员可执行该操作', 403));
  return next();
};

const requireAuditorReader = (req, _res, next) => {
  if (!canReadAudit(req)) return next(appError('仅审计管理员可查看该内容', 403));
  return next();
};

const requireAdminOnly = (req, _res, next) => {
  if (!isAdmin(req)) return next(appError('仅管理员可执行该操作', 403));
  return next();
};

const requireResultCenterReader = (req, _res, next) => {
  if (!canReadResultCenter(req)) return next(appError('仅管理员、审核员或审计管理员可查看考试结果中心', 403));
  return next();
};

const requireAiModelReader = (req, _res, next) => {
  if (!canReadAiModelConfig(req)) return next(appError('仅管理员可查看模型配置', 403));
  return next();
};

const getClientIp = (req) => trimText(req.ip) || trimText(req.socket?.remoteAddress) || '';

const normalizeClientIp = (value) => {
  let text = trimText(value);
  if (!text) return '';
  if (text.includes(',')) {
    text = trimText(text.split(',')[0]);
  }
  if (text.startsWith('[') && text.includes(']')) {
    text = trimText(text.slice(1, text.indexOf(']')));
  }
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(text)) {
    text = text.replace(/^::ffff:/i, '');
  }
  const zoneIndex = text.indexOf('%');
  if (zoneIndex > 0) {
    text = trimText(text.slice(0, zoneIndex));
  }
  return net.isIP(text) ? text.toLowerCase() : '';
};

const isPrivateIpv4Address = (value) => {
  const parts = String(value || '').split('.').map((item) => Number(item));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
};

const isPrivateRequestIp = (req) => {
  const forwarded = normalizeClientIp(req.headers['x-forwarded-for']);
  const actual = forwarded || normalizeClientIp(getClientIp(req));
  if (!actual) return false;
  const family = net.isIP(actual);
  if (family === 4) return isPrivateIpv4Address(actual);
  if (family === 6) {
    return actual === '::1' || actual.startsWith('fc') || actual.startsWith('fd') || actual.startsWith('fe80:');
  }
  return false;
};

const getRequestHost = (req) => {
  const raw = trimText(req.headers['x-forwarded-host'] || req.headers.host).toLowerCase();
  if (!raw) return '';
  return trimText(raw.split(',')[0]).toLowerCase();
};

const buildSecurityEventLogPayload = ({ req, statusCode, message, action }) => ({
  req,
  action,
  entity: 'security_event',
  entityId: null,
  message,
  afterData: {
    status_code: Number(statusCode || 0),
    method: trimText(req?.method).toUpperCase(),
    path: trimText(String(req?.originalUrl || '').split('?')[0]),
    request_ip: trimText(getClientIp(req)),
  },
});

const buildRateLimitMiddleware = ({ keyPrefix, windowMs, limit, message = '操作过于频繁，请稍后再试' }) => {
  const limiter = createMemoryRateLimiter({ windowMs, limit });
  return (req, _res, next) => {
    const userId = Number(req.user?.id || 0) || 0;
    const key = `${keyPrefix}:${userId}:${getClientIp(req)}`;
    const result = limiter.consume(key);
    if (result.allowed) return next();
    const err = appError(message, 429);
    err.securityAction = 'RATE_LIMIT';
    err.retryAfterSeconds = Math.max(1, Math.ceil(Number(result.retryAfterMs || windowMs) / 1000));
    return next(err);
  };
};

const normalizeAiBaseUrlOrThrow = (value) => {
  try {
    return validateAiBaseUrl(value, {
      allowHttp: AI_ALLOW_INSECURE_HTTP,
      allowPrivateHosts: AI_ALLOW_PRIVATE_BASE_URLS,
    }).toString().replace(/\/+$/, '');
  } catch (err) {
    throw appError(trimText(err?.message || 'AI base_url 非法') || 'AI base_url 非法', 400);
  }
};

const getCourseSummaryById = async (courseId) =>
  get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [Number(courseId || 0)]);

const getResourceWithCourseById = async (resourceId) =>
  get(
    `SELECT
      r.*,
      c.id AS linked_course_id,
      c.title AS course_title,
      c.status AS course_status
     FROM te_course_resources r
     LEFT JOIN te_courses c ON c.id = r.course_id
     WHERE r.id = ?
     LIMIT 1`,
    [Number(resourceId || 0)]
  );

const ensureResourceReadAccess = (req, resource, message = '无权限访问该资源') => {
  if (!resource) throw appError('资源不存在', 404);
  ensureCourseReadAccess(
    req,
    {
      id: Number(resource.linked_course_id || resource.course_id || 0),
      title: trimText(resource.course_title),
      status: trimText(resource.course_status),
    },
    message
  );
  return resource;
};

const getPaperAccessRowById = async (paperId) =>
  get(
    `SELECT
      p.*,
      c.id AS linked_course_id,
      c.title AS course_title,
      c.status AS course_status
     FROM te_papers p
     LEFT JOIN te_courses c ON c.id = p.course_id
     WHERE p.id = ?
     LIMIT 1`,
    [Number(paperId || 0)]
  );

const ensurePaperReadAccess = (req, paper, message = '无权限访问该试卷') => {
  if (!paper) throw appError('试卷不存在', 404);
  if (isElevatedTrainExamReader(req)) return paper;
  if (trimText(paper.status).toLowerCase() !== 'published') throw appError(message, 403);
  const courseId = Number(paper.linked_course_id || paper.course_id || 0);
  if (courseId > 0) {
    ensureCourseReadAccess(
      req,
      {
        id: courseId,
        title: trimText(paper.course_title),
        status: trimText(paper.course_status),
      },
      message
    );
  }
  return paper;
};

const uploadRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'resource-upload',
  windowMs: 60 * 1000,
  limit: 6,
  message: '上传过于频繁，请稍后再试',
});
const importRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'question-import',
  windowMs: 10 * 60 * 1000,
  limit: 8,
  message: '导入过于频繁，请稍后再试',
});
const examStartRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'exam-start',
  windowMs: 5 * 60 * 1000,
  limit: 12,
  message: '开始考试请求过于频繁，请稍后再试',
});
const resultAdviceRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'result-advice',
  windowMs: 5 * 60 * 1000,
  limit: 10,
  message: 'AI 建议生成过于频繁，请稍后再试',
});
const certificateGenerateRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'certificate-generate',
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: '证书生成过于频繁，请稍后再试',
});
const aiModelTestRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'ai-model-test',
  windowMs: 60 * 1000,
  limit: 10,
  message: 'AI 模型测试过于频繁，请稍后再试',
});
const questionGenerationRunRateLimit = buildRateLimitMiddleware({
  keyPrefix: 'question-generation-run',
  windowMs: 5 * 60 * 1000,
  limit: 6,
  message: '自动出题执行过于频繁，请稍后再试',
});

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

const requireBasicViewerScope = (req, _res, next) => {
  if (!isBasicTrainExamUser(req)) return next();
  if (allowBasicViewerApi(req)) return next();
  return next(appError('普通用户仅可访问课程列表、试卷列表和考试结果功能', 403));
};

const sanitizeFileName = (name) => String(name || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'file';

const buildStoredFilePath = (rootDir, originalName) => {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const baseName = path.basename(originalName || `upload-${Date.now()}`, ext);
  const safeBaseName = sanitizeFileName(baseName);
  const finalName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeBaseName}${ext}`;
  return path.join(rootDir, finalName);
};

const writeUploadFile = async (rootDir, originalName, buffer) => {
  const fullPath = buildStoredFilePath(rootDir, originalName);
  await fs.promises.writeFile(fullPath, buffer);
  return fullPath;
};

const moveUploadFile = async (rootDir, originalName, tempFilePath) => {
  const fullPath = buildStoredFilePath(rootDir, originalName);
  try {
    await fs.promises.rename(tempFilePath, fullPath);
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(tempFilePath, fullPath);
    await fs.promises.unlink(tempFilePath).catch(() => {});
  }
  return fullPath;
};

const resolveSafePathWithinRoot = (filePath, rootDir) => {
  const text = trimText(filePath);
  if (!text) return '';
  const resolved = path.resolve(text);
  const base = path.resolve(rootDir);
  const relative = path.relative(base, resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }
  return '';
};

const removeResourceFileIfExists = async (filePath) => {
  const safePath = resolveSafePathWithinRoot(filePath, RESOURCE_ROOT);
  if (!safePath) return false;
  const stat = await fs.promises.stat(safePath).catch(() => null);
  if (!stat || !stat.isFile()) return false;
  await fs.promises.unlink(safePath).catch(() => {});
  return true;
};

const removeCertificateFileIfExists = async (filePath) => {
  const safePath = resolveSafePathWithinRoot(filePath, CERT_ROOT);
  if (!safePath) return false;
  const stat = await fs.promises.stat(safePath).catch(() => null);
  if (!stat || !stat.isFile()) return false;
  await fs.promises.unlink(safePath).catch(() => {});
  return true;
};

const listUploadedCertificateTemplateFiles = async () => {
  const entries = await fs.promises.readdir(CERT_TEMPLATE_DIR, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry?.isFile?.()) continue;
    const name = trimText(entry.name);
    if (!name) continue;
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_CERT_TEMPLATE_EXTS.has(ext)) continue;
    const fullPath = path.join(CERT_TEMPLATE_DIR, name);
    const stat = await fs.promises.stat(fullPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    files.push({
      name,
      ext,
      path: fullPath,
      size: Number(stat.size || 0),
      updatedAt: stat.mtime ? toMysqlDatetime(stat.mtime) : null,
      mtime: stat.mtimeMs || 0,
    });
  }
  files.sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0));
  return files;
};

const resolveRuntimeCertificateTemplate = async () => {
  const uploadedFiles = await listUploadedCertificateTemplateFiles();
  if (uploadedFiles.length > 0) {
    const current = uploadedFiles[0];
    return {
      exists: true,
      source: 'uploaded',
      canDelete: true,
      path: current.path,
      fileName: current.name,
      ext: current.ext,
      sizeBytes: current.size,
      updatedAt: current.updatedAt,
    };
  }

  const envPath = trimText(process.env.CERT_TEMPLATE_PATH);
  if (!envPath) {
    return {
      exists: false,
      source: 'none',
      canDelete: false,
      path: '',
      fileName: '',
      ext: '',
      sizeBytes: 0,
      updatedAt: null,
    };
  }

  const resolvedPath = path.resolve(envPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  if (!ALLOWED_CERT_TEMPLATE_EXTS.has(ext)) {
    return {
      exists: false,
      source: 'env_invalid',
      canDelete: false,
      path: '',
      fileName: '',
      ext: '',
      sizeBytes: 0,
      updatedAt: null,
    };
  }
  const stat = await fs.promises.stat(resolvedPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return {
      exists: false,
      source: 'env_missing',
      canDelete: false,
      path: '',
      fileName: '',
      ext: '',
      sizeBytes: 0,
      updatedAt: null,
    };
  }

  return {
    exists: true,
    source: 'env',
    canDelete: false,
    path: resolvedPath,
    fileName: path.basename(resolvedPath),
    ext,
    sizeBytes: Number(stat.size || 0),
    updatedAt: stat.mtime ? toMysqlDatetime(stat.mtime) : null,
  };
};

const deleteCourseCascade = async ({ courseId, force = false }) => {
  const id = Number(courseId || 0);
  const before = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('课程不存在', 404);

  const resources = await query('SELECT * FROM te_course_resources WHERE course_id = ?', [id]);
  const resourceIds = resources
    .map((item) => Number(item?.id || 0))
    .filter((item) => Number.isInteger(item) && item > 0);

  if (!force && resourceIds.length > 0) {
    throw appError('课程下仍有培训资源，不能删除', 409);
  }

  let removedFiles = 0;
  let removedResources = 0;

  if (resourceIds.length) {
    const marks = resourceIds.map(() => '?').join(',');
    const jobRows = await query(
      `SELECT id, source_path, target_path
       FROM te_resource_transcode_jobs
       WHERE resource_id IN (${marks})`,
      resourceIds
    );

    await run(
      `UPDATE te_resource_transcode_jobs
       SET status = 'skipped',
           progress_percent = 100,
           error_message = CASE
             WHEN IFNULL(error_message, '') = '' THEN '课程已删除，任务已取消'
             ELSE error_message
           END,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE resource_id IN (${marks}) AND status IN ('queued', 'running')`,
      resourceIds
    );

    await run('DELETE FROM te_resource_progress WHERE course_id = ?', [id]);
    await run(`DELETE FROM te_resource_transcode_jobs WHERE resource_id IN (${marks})`, resourceIds);
    const deleted = await run('DELETE FROM te_course_resources WHERE course_id = ?', [id]);
    removedResources = Number(deleted?.affectedRows || 0);

    const files = new Set();
    for (const item of resources) {
      const storagePath = trimText(item?.storage_path);
      if (storagePath) files.add(storagePath);
    }
    for (const row of jobRows) {
      const sourcePath = trimText(row?.source_path);
      const targetPath = trimText(row?.target_path);
      if (sourcePath) files.add(sourcePath);
      if (targetPath) files.add(targetPath);
    }
    for (const filePath of files) {
      const removed = await removeResourceFileIfExists(filePath);
      if (removed) removedFiles += 1;
    }
  } else {
    await run('DELETE FROM te_resource_progress WHERE course_id = ?', [id]);
  }

  await run('DELETE FROM te_courses WHERE id = ?', [id]);
  return { before, removedResources, removedFiles };
};

const normalizeTags = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => trimText(item)).filter(Boolean))).slice(0, 50);
  }
  const text = trimText(value);
  if (!text) return [];
  return Array.from(new Set(text.split(/[，,、]/).map((item) => trimText(item)).filter(Boolean))).slice(0, 50);
};

const parseTextList = (value, { upper = false } = {}) => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => trimText(item))
          .filter(Boolean)
          .map((item) => (upper ? item.toUpperCase() : item))
      )
    );
  }
  const text = trimText(value);
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[，,、\n\r;；|]+/)
        .map((item) => trimText(item))
        .filter(Boolean)
        .map((item) => (upper ? item.toUpperCase() : item))
    )
  );
};

const normalizeQuestionCategory = (value, fallback = '未分类') => {
  const text = trimText(value || fallback);
  return text ? text.slice(0, 64) : '未分类';
};

const SYSTEM_QUESTION_CATEGORY_SET = new Set(['未分类', '手工创建', 'FAQ自动出题', 'Excel导入']);

const getDefaultQuestionCategoryBySource = (sourceType = 'manual') => {
  const key = trimText(sourceType).toLowerCase();
  if (key === 'faq_auto') return 'FAQ自动出题';
  if (key === 'import') return 'Excel导入';
  if (key === 'manual') return '手工创建';
  return '未分类';
};

const upsertQuestionCategory = async ({ categoryName, user, isSystem = false, tx = null }) => {
  const name = normalizeQuestionCategory(categoryName, '');
  if (!name) return null;
  const actor = tx || { run };
  await actor.run(
    `INSERT INTO te_question_categories
      (name, is_system, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      is_system = GREATEST(is_system, VALUES(is_system)),
      updated_by_id = VALUES(updated_by_id),
      updated_by_name = VALUES(updated_by_name),
      updated_at = NOW()`,
    [
      name,
      isSystem ? 1 : 0,
      Number(user?.id) || null,
      trimText(user?.username) || null,
      Number(user?.id) || null,
      trimText(user?.username) || null,
    ]
  );
  return name;
};

const listQuestionCategoryRows = async () => {
  const rows = await query(
    `SELECT
      c.id,
      c.name,
      c.is_system,
      c.created_at,
      c.updated_at,
      COUNT(q.id) AS question_count,
      SUM(CASE WHEN q.status = 'published' THEN 1 ELSE 0 END) AS published_question_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'single_choice' THEN 1 ELSE 0 END) AS published_single_choice_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'multiple_choice' THEN 1 ELSE 0 END) AS published_multiple_choice_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'judgement' THEN 1 ELSE 0 END) AS published_judgement_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'fill_blank' THEN 1 ELSE 0 END) AS published_fill_blank_count
     FROM te_question_categories c
     LEFT JOIN te_question_bank q ON q.question_category = c.name
     GROUP BY c.id, c.name, c.is_system, c.created_at, c.updated_at
     ORDER BY c.is_system DESC, c.name ASC, c.id ASC`
  );

  return rows.map((item) => normalizeQuestionCategoryRow(item));
};

const listQuestionCategoryNames = async () => {
  const rows = await listQuestionCategoryRows();
  return rows.map((item) => trimText(item.name)).filter(Boolean);
};

const toJoinedText = (values = []) => parseTextList(values).join('，');

const normalizeResourceType = (value) => {
  const raw = trimText(value);
  const key = raw.toLowerCase();
  return RESOURCE_TYPE_ALIASES[key] || RESOURCE_TYPE_ALIASES[raw] || key;
};

const normalizeSourceMode = (value) => {
  const raw = trimText(value);
  const key = raw.toLowerCase();
  return SOURCE_MODE_ALIASES[key] || SOURCE_MODE_ALIASES[raw] || key;
};

const normalizeDocPreviewMinSeconds = (value, fallback = DOC_PREVIEW_MIN_SECONDS_DEFAULT) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(DOC_PREVIEW_MIN_SECONDS_MIN, Math.min(DOC_PREVIEW_MIN_SECONDS_MAX, Math.round(n)));
};

const getSystemSettingValue = async (settingKey) => {
  const key = trimText(settingKey);
  if (!key) return '';
  const row = await get(
    'SELECT setting_value FROM te_system_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  return trimText(row?.setting_value);
};

const getSystemSettingValues = async (settingKeys = []) => {
  const keys = Array.from(new Set((Array.isArray(settingKeys) ? settingKeys : [settingKeys]).map((item) => trimText(item)).filter(Boolean)));
  if (!keys.length) return {};
  const placeholders = keys.map(() => '?').join(',');
  const rows = await query(
    `SELECT setting_key, setting_value
     FROM te_system_settings
     WHERE setting_key IN (${placeholders})`,
    keys
  );
  return rows.reduce((acc, row) => {
    const key = trimText(row?.setting_key);
    if (!key) return acc;
    acc[key] = trimText(row?.setting_value);
    return acc;
  }, {});
};

const upsertSystemSettingValue = async ({ settingKey, settingValue, user }) => {
  const key = trimText(settingKey);
  if (!key) throw appError('配置键不能为空', 400);
  const valueText = trimText(settingValue);
  await run(
    `INSERT INTO te_system_settings
      (setting_key, setting_value, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      setting_value = VALUES(setting_value),
      updated_by_id = VALUES(updated_by_id),
      updated_by_name = VALUES(updated_by_name),
      updated_at = NOW()`,
    [
      key,
      valueText,
      Number(user?.id) || null,
      trimText(user?.username) || null,
    ]
  );
};

const getDocPreviewMinSeconds = async () => {
  const valueText = await getSystemSettingValue('doc_preview_min_seconds');
  if (!valueText) return DOC_PREVIEW_MIN_SECONDS_DEFAULT;
  return normalizeDocPreviewMinSeconds(valueText, DOC_PREVIEW_MIN_SECONDS_DEFAULT);
};

const resolveDocMimeType = ({ mimeType, filePath }) => {
  const raw = trimText(mimeType).toLowerCase();
  if (raw && raw !== 'application/octet-stream') return raw;
  const ext = path.extname(trimText(filePath)).toLowerCase();
  return DOC_MIME_BY_EXT[ext] || 'application/octet-stream';
};

const resolveOnlyOfficeDocumentType = (ext = '') => {
  const normalized = String(ext || '').toLowerCase();
  if (['.xls', '.xlsx', '.csv'].includes(normalized)) return 'cell';
  if (['.ppt', '.pptx'].includes(normalized)) return 'slide';
  if (normalized === '.pdf') return 'pdf';
  return 'word';
};

const buildDocPreviewFileToken = ({ resourceId, userId, username }) =>
  jwt.sign(
    {
      purpose: 'doc_preview_file',
      resource_id: Number(resourceId || 0),
      user_id: Number(userId || 0) || null,
      username: trimText(username) || null,
      allowed_host: DOC_EDITOR_FILE_ALLOWED_HOST,
    },
    DOC_EDITOR_JWT_SECRET,
    { expiresIn: `${DOC_PREVIEW_FILE_TOKEN_TTL_SECONDS}s` }
  );

const verifyDocPreviewFileToken = (value) => {
  const token = trimText(value);
  if (!token) throw appError('缺少预览访问令牌', 401);
  try {
    const payload = jwt.verify(token, DOC_EDITOR_JWT_SECRET);
    if (trimText(payload?.purpose) !== 'doc_preview_file') throw appError('预览访问令牌用途非法', 401);
    return payload;
  } catch {
    throw appError('预览访问令牌无效或已过期', 401);
  }
};

const buildDocPreviewEditorPayload = ({ resource, req, stat, minReadSeconds = DOC_PREVIEW_MIN_SECONDS_DEFAULT }) => {
  const ext = path.extname(trimText(resource?.storage_path)).toLowerCase();
  if (!ALLOWED_DOC_EXTS.has(ext)) throw appError('当前文档类型不支持在线预览', 400);

  const fileToken = buildDocPreviewFileToken({
    resourceId: Number(resource?.id || 0),
    userId: Number(req?.user?.id || 0),
    username: trimText(req?.user?.username),
  });
  const fileUrl = `${DOC_EDITOR_FILE_BASE_URL}/api/train-exam/resources/${Number(resource.id)}/doc-preview-file?token=${encodeURIComponent(fileToken)}`;
  const titleBase = trimText(resource?.name) || `文档-${Number(resource?.id || 0)}`;
  const titleWithExt = titleBase.toLowerCase().endsWith(ext) ? titleBase : `${titleBase}${ext}`;
  const versionSeed = trimText(resource?.updated_at || resource?.created_at || stat?.mtimeMs || Date.now());
  const keyHash = crypto.createHash('sha1').update(`${Number(resource?.id || 0)}-${versionSeed}-${Number(stat?.size || 0)}`).digest('hex').slice(0, 24);
  const documentType = resolveOnlyOfficeDocumentType(ext);
  const fileType = String(ext || '.txt').replace(/^\./, '') || 'txt';

  const config = {
    document: {
      fileType,
      key: `te-doc-${Number(resource?.id || 0)}-${keyHash}`,
      title: titleWithExt,
      url: fileUrl,
      permissions: {
        edit: false,
        download: true,
        print: true,
        review: false,
        comment: false,
      },
    },
    documentType,
    editorConfig: {
      mode: 'view',
      lang: 'zh-CN',
      user: {
        id: String(Number(req?.user?.id || 0) || Number(resource?.created_by_id || 0) || 0),
        name: String(trimText(req?.user?.username) || trimText(resource?.created_by_name) || '学员'),
      },
      customization: {
        autosave: false,
        forcesave: false,
      },
    },
  };

  return {
    provider: DOC_EDITOR_PROVIDER,
    server_path: DOC_EDITOR_PUBLIC_PATH,
    min_read_seconds: normalizeDocPreviewMinSeconds(minReadSeconds, DOC_PREVIEW_MIN_SECONDS_DEFAULT),
    resource: {
      id: Number(resource?.id || 0),
      name: trimText(resource?.name),
      file_ext: ext,
      source_mode: normalizeSourceMode(resource?.source_mode),
    },
    editor: {
      config,
      token: jwt.sign(config, DOC_EDITOR_JWT_SECRET, { expiresIn: '30m' }),
    },
  };
};

const resolveVideoMimeType = ({ mimeType, filePath }) => {
  const raw = trimText(mimeType).toLowerCase();
  if (raw && raw !== 'application/octet-stream') {
    if (ALLOWED_VIDEO_MIME.has(raw) || raw.startsWith('video/')) return raw;
  }
  const ext = path.extname(trimText(filePath)).toLowerCase();
  return VIDEO_MIME_BY_EXT[ext] || 'video/mp4';
};

const looksLikeVideoContainerHeader = ({ header, ext }) => {
  const extLower = String(ext || '').toLowerCase();
  if (!Buffer.isBuffer(header) || !header.length) return false;
  if (extLower === '.webm') {
    return header.length >= 4
      && header[0] === 0x1a
      && header[1] === 0x45
      && header[2] === 0xdf
      && header[3] === 0xa3;
  }
  if (!ALLOWED_VIDEO_EXTS.has(extLower)) return false;
  const text = header.toString('latin1');
  return text.includes('ftyp');
};

const validateVideoContainer = async ({ filePath, ext, fileBuffer }) => {
  const extLower = String(ext || path.extname(trimText(filePath))).toLowerCase();
  if (!ALLOWED_VIDEO_EXTS.has(extLower)) return false;
  if (fileBuffer && Buffer.isBuffer(fileBuffer)) {
    const header = fileBuffer.subarray(0, Math.min(128, fileBuffer.length));
    return looksLikeVideoContainerHeader({ header, ext: extLower });
  }
  const handle = await fs.promises.open(filePath, 'r').catch(() => null);
  if (!handle) return false;
  try {
    const header = Buffer.alloc(128);
    const readResult = await handle.read(header, 0, header.length, 0);
    const head = header.subarray(0, Number(readResult?.bytesRead || 0));
    return looksLikeVideoContainerHeader({ header: head, ext: extLower });
  } finally {
    await handle.close().catch(() => {});
  }
};

const readFileSlice = async (filePath, offset, length) => {
  const handle = await fs.promises.open(filePath, 'r').catch(() => null);
  if (!handle) return Buffer.alloc(0);
  try {
    const safeLength = Math.max(0, Number(length || 0));
    if (!safeLength) return Buffer.alloc(0);
    const buffer = Buffer.alloc(safeLength);
    const result = await handle.read(buffer, 0, safeLength, Math.max(0, Number(offset || 0)));
    return buffer.subarray(0, Number(result?.bytesRead || 0));
  } finally {
    await handle.close().catch(() => {});
  }
};

const detectVideoCodecTag = async (filePath) => {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) return 'unknown';
  const size = Number(stat.size || 0);
  if (size <= 0) return 'unknown';
  const headSize = Math.min(1024 * 1024, size);
  const tailSize = Math.min(2 * 1024 * 1024, size);
  const head = await readFileSlice(filePath, 0, headSize);
  const tailOffset = Math.max(0, size - tailSize);
  const tail = await readFileSlice(filePath, tailOffset, tailSize);
  const markerText = Buffer.concat([head, tail]).toString('latin1').toLowerCase();
  if (markerText.includes('hvc1') || markerText.includes('hev1')) return 'hevc';
  if (markerText.includes('avc1') || markerText.includes('avc3')) return 'h264';
  if (markerText.includes('av01')) return 'av1';
  if (markerText.includes('vp09')) return 'vp9';
  if (markerText.includes('vp08')) return 'vp8';
  return 'unknown';
};

const assessVideoPlayability = async ({ resource, filePath }) => {
  if (normalizeSourceMode(resource?.source_mode) === 'external') {
    return { playable: true, reason: '', codec: 'external' };
  }
  const resourceType = normalizeResourceType(resource?.resource_type);
  if (resourceType !== 'video') {
    return { playable: false, reason: '当前资源不是视频资源', codec: 'unknown' };
  }
  const validContainer = await validateVideoContainer({ filePath, ext: path.extname(trimText(filePath)).toLowerCase() });
  if (!validContainer) {
    return { playable: false, reason: '视频文件格式异常或已损坏，请重新上传后再播放', codec: 'unknown' };
  }
  const codec = await detectVideoCodecTag(filePath);
  if (codec === 'hevc') {
    return {
      playable: false,
      reason: '当前视频编码为 HEVC(H.265/hvc1)，请重新上传，系统会在后台自动转码为 H.264',
      codec,
    };
  }
  return { playable: true, reason: '', codec };
};

const runProcess = ({
  command,
  args = [],
  timeoutMs = 60000,
  captureStdout = false,
  onStderrLine,
}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    let stderr = '';
    let stdout = '';
    const maxStderrLength = 8000;
    const maxStdoutLength = 8000;
    let stderrLineBuffer = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${command} 执行超时`));
    }, Math.max(1000, Number(timeoutMs || 60000)));

    if (captureStdout && proc.stdout) {
      proc.stdout.on('data', (chunk) => {
        if (!chunk) return;
        stdout += String(chunk);
        if (stdout.length > maxStdoutLength) {
          stdout = stdout.slice(stdout.length - maxStdoutLength);
        }
      });
    }

    proc.stderr.on('data', (chunk) => {
      if (!chunk) return;
      const text = String(chunk);
      stderr += text;
      if (stderr.length > maxStderrLength) {
        stderr = stderr.slice(stderr.length - maxStderrLength);
      }
      if (typeof onStderrLine === 'function') {
        stderrLineBuffer += text.replace(/\r/g, '\n');
        const parts = stderrLineBuffer.split('\n');
        stderrLineBuffer = parts.pop() || '';
        for (const line of parts) {
          const normalizedLine = trimText(line);
          if (!normalizedLine) continue;
          try {
            onStderrLine(normalizedLine);
          } catch {
            // 进度解析失败时仅忽略，不影响主流程
          }
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (typeof onStderrLine === 'function') {
        const tailLine = trimText(stderrLineBuffer);
        if (tailLine) {
          try {
            onStderrLine(tailLine);
          } catch {
            // ignore
          }
        }
      }
      if (code === 0) {
        resolve({ code: 0, stderr: trimText(stderr), stdout: trimText(stdout) });
        return;
      }
      const tail = trimText(stderr).slice(-600);
      reject(new Error(tail || `${command} 执行失败(${code})`));
    });
  });

const parseClockTimeToSeconds = (value) => {
  const text = trimText(value);
  if (!text) return 0;
  const match = text.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  const total = h * 3600 + m * 60 + s;
  return Number.isFinite(total) && total > 0 ? total : 0;
};

const probeVideoDurationSeconds = async (filePath) => {
  const pathText = trimText(filePath);
  if (!pathText) return 0;
  try {
    const result = await runProcess({
      command: 'ffprobe',
      args: [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        pathText,
      ],
      timeoutMs: 30000,
      captureStdout: true,
    });
    const duration = Number(trimText(result?.stdout));
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
};

const transcodeVideoToH264 = async ({ inputPath, onProgress }) => {
  const sourcePath = trimText(inputPath);
  if (!sourcePath) throw new Error('转码输入文件缺失');

  const ext = path.extname(sourcePath).toLowerCase();
  const targetDir = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, ext) || `video-${Date.now()}`;
  const targetPath = path.join(targetDir, `${baseName}-h264-${Date.now()}.mp4`);
  const durationSeconds = await probeVideoDurationSeconds(sourcePath);
  let lastEmittedPercent = -1;
  let lastEmittedAt = 0;
  const emitProgress = (percent, { force = false } = {}) => {
    if (typeof onProgress !== 'function') return;
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent || 0))));
    const now = Date.now();
    if (!force) {
      if (safePercent <= lastEmittedPercent) return;
      if (now - lastEmittedAt < 1000 && safePercent < lastEmittedPercent + 2) return;
    }
    lastEmittedPercent = safePercent;
    lastEmittedAt = now;
    onProgress(safePercent);
  };

  try {
    await runProcess({
      command: 'ffmpeg',
      args: [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostats',
        '-progress',
        'pipe:2',
        '-y',
        '-i',
        sourcePath,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        VIDEO_TRANSCODE_PRESET,
        '-crf',
        String(VIDEO_TRANSCODE_CRF),
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        targetPath,
      ],
      timeoutMs: VIDEO_TRANSCODE_TIMEOUT_MS,
      onStderrLine: (line) => {
        const idx = line.indexOf('=');
        if (idx <= 0) return;
        const key = trimText(line.slice(0, idx)).toLowerCase();
        const value = trimText(line.slice(idx + 1));
        if (!key) return;
        if (key === 'progress' && value === 'end') {
          emitProgress(100, { force: true });
          return;
        }
        if (!durationSeconds || durationSeconds <= 0) return;
        if (key === 'out_time_us' || key === 'out_time_ms') {
          const outUs = Number(value);
          if (!Number.isFinite(outUs) || outUs < 0) return;
          const outSeconds = outUs / 1000000;
          emitProgress((outSeconds / durationSeconds) * 100);
          return;
        }
        if (key === 'out_time') {
          const outSeconds = parseClockTimeToSeconds(value);
          if (outSeconds <= 0) return;
          emitProgress((outSeconds / durationSeconds) * 100);
        }
      },
    });
  } catch (err) {
    await fs.promises.unlink(targetPath).catch(() => {});
    throw err;
  }

  const stat = await fs.promises.stat(targetPath).catch(() => null);
  if (!stat || !stat.isFile() || Number(stat.size || 0) <= 0) {
    await fs.promises.unlink(targetPath).catch(() => {});
    throw new Error('转码后文件无效');
  }

  return {
    outputPath: targetPath,
    outputSize: Number(stat.size || 0),
  };
};

const normalizeTranscodeStatus = (value, fallback = 'none') => {
  const key = trimText(value).toLowerCase();
  if (['none', 'queued', 'running', 'succeeded', 'failed', 'skipped'].includes(key)) return key;
  return fallback;
};

const markResourceTranscodeState = async ({
  resourceId,
  status,
  progressPercent,
  message,
  jobId,
  storagePath,
  mimeType,
  fileSize,
}) => {
  const fields = [];
  const params = [];

  fields.push('transcode_status = ?');
  params.push(normalizeTranscodeStatus(status, 'none'));

  if (progressPercent !== undefined) {
    fields.push('transcode_progress = ?');
    params.push(Math.max(0, Math.min(100, Math.round(Number(progressPercent || 0)))));
  }
  if (message !== undefined) {
    fields.push('transcode_message = ?');
    params.push(trimText(message) || null);
  }
  if (jobId !== undefined) {
    fields.push('transcode_job_id = ?');
    params.push(Number(jobId || 0) || null);
  }
  if (storagePath !== undefined) {
    fields.push('storage_path = ?');
    params.push(trimText(storagePath) || null);
  }
  if (mimeType !== undefined) {
    fields.push('mime_type = ?');
    params.push(trimText(mimeType) || null);
  }
  if (fileSize !== undefined) {
    fields.push('file_size = ?');
    params.push(Number(fileSize || 0) || null);
  }

  fields.push('updated_at = NOW()');
  params.push(Number(resourceId || 0));
  await run(`UPDATE te_course_resources SET ${fields.join(', ')} WHERE id = ?`, params);
};

const markTranscodeJob = async ({
  jobId,
  status,
  progressPercent,
  errorMessage,
  sourceCodec,
  targetCodec,
  targetPath,
  startedAt,
  finishedAt,
}) => {
  const fields = [];
  const params = [];

  if (status !== undefined) {
    fields.push('status = ?');
    params.push(normalizeTranscodeStatus(status, 'queued'));
  }

  if (progressPercent !== undefined) {
    fields.push('progress_percent = ?');
    params.push(Math.max(0, Math.min(100, Math.round(Number(progressPercent || 0)))));
  }
  if (errorMessage !== undefined) {
    fields.push('error_message = ?');
    params.push(trimText(errorMessage) || null);
  }
  if (sourceCodec !== undefined) {
    fields.push('source_codec = ?');
    params.push(trimText(sourceCodec) || null);
  }
  if (targetCodec !== undefined) {
    fields.push('target_codec = ?');
    params.push(trimText(targetCodec) || null);
  }
  if (targetPath !== undefined) {
    fields.push('target_path = ?');
    params.push(trimText(targetPath) || null);
  }
  if (startedAt !== undefined) {
    fields.push('started_at = ?');
    params.push(startedAt);
  }
  if (finishedAt !== undefined) {
    fields.push('finished_at = ?');
    params.push(finishedAt);
  }

  if (!fields.length) return;
  fields.push('updated_at = NOW()');
  params.push(Number(jobId || 0));
  await run(`UPDATE te_resource_transcode_jobs SET ${fields.join(', ')} WHERE id = ?`, params);
};

const createTranscodeJob = async ({ resourceId, sourcePath, sourceCodec, operator }) => {
  const result = await run(
    `INSERT INTO te_resource_transcode_jobs
      (resource_id, source_path, status, progress_percent, source_codec, created_by_id, created_by_name)
     VALUES (?, ?, 'queued', 0, ?, ?, ?)`,
    [
      Number(resourceId || 0),
      trimText(sourcePath),
      trimText(sourceCodec) || null,
      Number(operator?.id || 0) || null,
      trimText(operator?.username) || null,
    ]
  );
  return Number(result.insertId || 0);
};

const processOneTranscodeJob = async (job) => {
  const jobId = Number(job?.id || 0);
  if (!jobId) return;

  const claim = await run(
    `UPDATE te_resource_transcode_jobs
     SET status = 'running', progress_percent = 0, started_at = NOW(), updated_at = NOW()
     WHERE id = ? AND status = 'queued'`,
    [jobId]
  );
  if (Number(claim?.affectedRows || 0) === 0) return;

  const runningJob = await get('SELECT * FROM te_resource_transcode_jobs WHERE id = ? LIMIT 1', [jobId]);
  if (!runningJob) return;
  const resourceId = Number(runningJob.resource_id || 0);
  const sourcePath = trimText(runningJob.source_path);

  await markResourceTranscodeState({
    resourceId,
    status: 'running',
    progressPercent: 0,
    message: '视频正在后台转码，请稍候...',
    jobId,
  });

  const resource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [resourceId]);
  if (!resource) {
    await markTranscodeJob({
      jobId,
      status: 'failed',
      progressPercent: 100,
      errorMessage: '关联资源不存在',
      finishedAt: toMysqlDatetime(new Date()),
    });
    return;
  }

  if (normalizeSourceMode(resource.source_mode) !== 'upload' || normalizeResourceType(resource.resource_type) !== 'video') {
    await markTranscodeJob({
      jobId,
      status: 'skipped',
      progressPercent: 100,
      errorMessage: '当前资源不再是上传视频，任务已跳过',
      finishedAt: toMysqlDatetime(new Date()),
    });
    await markResourceTranscodeState({
      resourceId,
      status: 'skipped',
      progressPercent: 100,
      message: '当前资源不是上传视频，已跳过转码',
      jobId,
    });
    return;
  }

  if (trimText(resource.storage_path) !== sourcePath) {
    await markTranscodeJob({
      jobId,
      status: 'skipped',
      progressPercent: 100,
      errorMessage: '检测到更新版本文件，旧任务已跳过',
      finishedAt: toMysqlDatetime(new Date()),
    });
    return;
  }

  const stat = await fs.promises.stat(sourcePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    await markTranscodeJob({
      jobId,
      status: 'failed',
      progressPercent: 100,
      errorMessage: '源视频文件不存在',
      finishedAt: toMysqlDatetime(new Date()),
    });
    await markResourceTranscodeState({
      resourceId,
      status: 'failed',
      progressPercent: 100,
      message: '源视频文件不存在，请重新上传',
      jobId,
    });
    return;
  }

  const ext = path.extname(sourcePath).toLowerCase();
  const containerOk = await validateVideoContainer({ filePath: sourcePath, ext });
  if (!containerOk) {
    await markTranscodeJob({
      jobId,
      status: 'failed',
      progressPercent: 100,
      errorMessage: '视频容器格式异常',
      finishedAt: toMysqlDatetime(new Date()),
    });
    await markResourceTranscodeState({
      resourceId,
      status: 'failed',
      progressPercent: 100,
      message: '视频格式异常，请重新上传',
      jobId,
    });
    return;
  }

  const sourceCodec = await detectVideoCodecTag(sourcePath);
  await markTranscodeJob({ jobId, sourceCodec, progressPercent: 5 });

  if (sourceCodec === 'h264' && ext === '.mp4') {
    await markTranscodeJob({
      jobId,
      status: 'succeeded',
      progressPercent: 100,
      targetPath: sourcePath,
      targetCodec: 'h264',
      finishedAt: toMysqlDatetime(new Date()),
    });
    await markResourceTranscodeState({
      resourceId,
      status: 'succeeded',
      progressPercent: 100,
      message: '无需转码，可直接播放',
      jobId,
      storagePath: sourcePath,
      mimeType: 'video/mp4',
      fileSize: Number(stat.size || 0),
    });
    return;
  }

  let transcodeOutput = '';
  let transcodeHeartbeatTimer = null;
  try {
    let maxMappedProgress = 0;
    let lastNativeProgressAt = Date.now();
    let progressUpdateChain = Promise.resolve();
    const stopTranscodeHeartbeat = () => {
      if (transcodeHeartbeatTimer) {
        clearInterval(transcodeHeartbeatTimer);
        transcodeHeartbeatTimer = null;
      }
    };
    const queueTranscodeProgressUpdate = (mappedProgress) => {
      const safeMappedProgress = Math.max(0, Math.min(95, Math.round(Number(mappedProgress || 0))));
      if (safeMappedProgress <= maxMappedProgress) return;
      maxMappedProgress = safeMappedProgress;
      progressUpdateChain = progressUpdateChain
        .then(async () => {
          await markTranscodeJob({
            jobId,
            status: 'running',
            progressPercent: safeMappedProgress,
          });
          await markResourceTranscodeState({
            resourceId,
            status: 'running',
            progressPercent: safeMappedProgress,
            message: '视频正在后台转码，请稍候...',
            jobId,
          });
        })
        .catch((err) => {
          console.error('[train-exam] transcode progress update failed:', err);
        });
    };
    transcodeHeartbeatTimer = setInterval(() => {
      const idleMs = Date.now() - lastNativeProgressAt;
      if (idleMs < 5000) return;
      if (maxMappedProgress >= 92) return;
      queueTranscodeProgressUpdate(maxMappedProgress + 1);
    }, 5000);

    await markResourceTranscodeState({
      resourceId,
      status: 'running',
      progressPercent: 0,
      message: '视频正在后台转码，请稍候...',
      jobId,
    });
    const transcodeResult = await transcodeVideoToH264({
      inputPath: sourcePath,
      onProgress: (percent) => {
        lastNativeProgressAt = Date.now();
        const mappedProgress = (Math.max(0, Math.min(100, Number(percent || 0))) / 100) * 95;
        queueTranscodeProgressUpdate(mappedProgress);
      },
    });
    stopTranscodeHeartbeat();
    await progressUpdateChain;
    transcodeOutput = trimText(transcodeResult.outputPath);
    const outputSize = Number(transcodeResult.outputSize || 0);
    const outputCodec = await detectVideoCodecTag(transcodeOutput);
    await markTranscodeJob({
      jobId,
      progressPercent: Math.max(96, maxMappedProgress),
      targetPath: transcodeOutput,
      targetCodec: outputCodec,
    });

    const latestResource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [resourceId]);
    if (!latestResource || trimText(latestResource.storage_path) !== sourcePath) {
      await fs.promises.unlink(transcodeOutput).catch(() => {});
      await markTranscodeJob({
        jobId,
        status: 'skipped',
        progressPercent: 100,
        errorMessage: '检测到更新版本文件，旧任务已跳过',
        finishedAt: toMysqlDatetime(new Date()),
      });
      return;
    }

    await markResourceTranscodeState({
      resourceId,
      status: 'succeeded',
      progressPercent: 100,
      message: '转码完成，可开始播放',
      jobId,
      storagePath: transcodeOutput,
      mimeType: 'video/mp4',
      fileSize: outputSize,
    });

    await markTranscodeJob({
      jobId,
      status: 'succeeded',
      progressPercent: 100,
      targetPath: transcodeOutput,
      targetCodec: outputCodec,
      finishedAt: toMysqlDatetime(new Date()),
    });

    if (sourcePath !== transcodeOutput) {
      await fs.promises.unlink(sourcePath).catch(() => {});
    }
  } catch (err) {
    if (transcodeHeartbeatTimer) {
      clearInterval(transcodeHeartbeatTimer);
      transcodeHeartbeatTimer = null;
    }
    if (transcodeOutput) {
      await fs.promises.unlink(transcodeOutput).catch(() => {});
    }
    const message = trimText(err?.message || '转码失败');
    await markTranscodeJob({
      jobId,
      status: 'failed',
      progressPercent: 100,
      errorMessage: message,
      finishedAt: toMysqlDatetime(new Date()),
    });
    const latestResource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [resourceId]);
    if (latestResource && trimText(latestResource.storage_path) === sourcePath) {
      await markResourceTranscodeState({
        resourceId,
        status: 'failed',
        progressPercent: 100,
        message: `视频转码失败：${message}`,
        jobId,
      });
    }
  }
};

const runPendingTranscodeJobs = async () => {
  if (transcodeRunnerActive) return;
  transcodeRunnerActive = true;
  try {
    while (true) {
      const nextJob = await get(
        `SELECT *
         FROM te_resource_transcode_jobs
         WHERE status = 'queued'
         ORDER BY id ASC
         LIMIT 1`
      );
      if (!nextJob) break;
      await processOneTranscodeJob(nextJob);
    }
  } catch (err) {
    console.error('[train-exam] transcode runner error:', err);
  } finally {
    transcodeRunnerActive = false;
  }
};

const triggerTranscodeRunner = () => {
  setTimeout(() => {
    runPendingTranscodeJobs().catch((err) => {
      console.error('[train-exam] transcode trigger error:', err);
    });
  }, 0);
};

const resumePendingTranscodeJobs = async () => {
  await run(
    `UPDATE te_resource_transcode_jobs
     SET status = 'queued',
         progress_percent = 0,
         error_message = CASE
           WHEN IFNULL(error_message, '') = '' THEN '服务重启后任务自动恢复'
           ELSE error_message
         END,
         started_at = NULL,
         updated_at = NOW()
     WHERE status = 'running'`
  );
  triggerTranscodeRunner();
};

const parseStoredAnswerValues = (answerRow) => {
  const fromText = parseTextList(answerRow?.answer_values_text, { upper: false });
  if (fromText.length) return fromText;
  const fromJson = parseMaybeJson(answerRow?.answer_json, {});
  const values = Array.isArray(fromJson?.answer_values) ? fromJson.answer_values : [];
  return parseTextList(values, { upper: false });
};

const parseStoredAnswerAliases = (answerRow) => {
  const fromText = parseTextList(answerRow?.answer_aliases_text, { upper: false });
  if (fromText.length) return fromText;
  const fromJson = parseMaybeJson(answerRow?.answer_aliases_json, []);
  return parseTextList(fromJson, { upper: false });
};

const normalizeOrgLabel = (value, fallback = '未分配') => {
  const text = trimText(value);
  return text ? text.slice(0, 128) : fallback;
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

const parseIdArray = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
  }
  const text = trimText(value);
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[，,、\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );
};

const getUserProfileByIdentity = async ({ userId, username }) => {
  const uid = Number(userId || 0);
  if (uid > 0) {
    const byId = await get('SELECT * FROM te_user_profiles WHERE user_id = ? LIMIT 1', [uid]);
    if (byId) return byId;
  }
  const uname = trimText(username);
  if (!uname) return null;
  const byName = await get('SELECT * FROM te_user_profiles WHERE username = ? ORDER BY id DESC LIMIT 1', [uname]);
  return byName || null;
};

const resolveUserOrgProfile = async ({ userId, username }) => {
  const profile = await getUserProfileByIdentity({ userId, username });
  return {
    department: normalizeOrgLabel(profile?.department),
    position_title: normalizeOrgLabel(profile?.position_title),
    profile,
  };
};

const upsertUserProfile = async ({ userId, username, department, positionTitle, operator }) => {
  const uid = Number(userId || 0);
  if (!uid) throw appError('user_id 无效', 400);
  const uname = trimText(username || `user-${uid}`);
  if (!uname) throw appError('username 无效', 400);

  const dept = normalizeOrgLabel(department);
  const pos = normalizeOrgLabel(positionTitle);
  await run(
    `INSERT INTO te_user_profiles
      (user_id, username, department, position_title, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      department = VALUES(department),
      position_title = VALUES(position_title),
      updated_by_id = VALUES(updated_by_id),
      updated_by_name = VALUES(updated_by_name),
      updated_at = NOW()`,
    [
      uid,
      uname,
      dept,
      pos,
      Number(operator?.id || 0) || null,
      trimText(operator?.username) || null,
    ]
  );

  return getUserProfileByIdentity({ userId: uid, username: uname });
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

const logOperation = async ({ req, action, entity, entityId, message, beforeData, afterData }) => {
  try {
    const user = req?.user || {};
    const userId = Number(user.id || 0) || null;
    const username = trimText(user.username || 'system') || 'system';
    const role = trimText(user.role || 'system') || 'system';
    const beforeText = beforeData === undefined ? null : stableStringify(beforeData);
    const afterText = afterData === undefined ? null : stableStringify(afterData);
    const ip = trimText(getClientIp(req)) || null;
    const createdAt = toMysqlDatetime(new Date());

    await transaction(async (tx) => {
      const prev = await tx.get('SELECT signature FROM te_operation_logs ORDER BY id DESC LIMIT 1 FOR UPDATE');
      const prevHash = prev?.signature || null;
      const inserted = await tx.run(
        `INSERT INTO te_operation_logs
           (user_id, username, user_role, action, entity, entity_id, message, before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?, ?)`,
        [userId, username, role, action, entity, entityId || null, trimText(message) || null, beforeText, afterText, prevHash, null, ip, createdAt]
      );
      const rowId = Number(inserted.insertId || 0);
      if (!rowId) return;
      const signature = computeAuditSignature({
        id: rowId,
        prevHash,
        userId,
        username,
        role,
        action,
        entity,
        entityId,
        beforeData: beforeText,
        afterData: afterText,
        createdAt,
      });
      await tx.run('UPDATE te_operation_logs SET signature = ? WHERE id = ?', [signature, rowId]);
    });
  } catch (err) {
    console.warn('[train-exam] logOperation failed:', err?.message || err);
  }
};

const getFaqPool = async () => {
  if (faqPool) return faqPool;
  faqPool = mysql.createPool({
    host: FAQ_MYSQL_HOST,
    port: FAQ_MYSQL_PORT,
    user: FAQ_MYSQL_USER,
    password: FAQ_MYSQL_PASSWORD,
    database: FAQ_MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true,
  });
  await faqPool.query('SELECT 1');
  return faqPool;
};

const getPublishedFaqSources = async ({ categoryIds = [], articleIds = [], limit = QUESTION_GENERATION_MAX_SOURCES }) => {
  const pool = await getFaqPool();
  const where = ['a.is_deleted = 0', "a.status = 'published'", 'a.published_version_id IS NOT NULL'];
  const params = [];

  if (categoryIds.length) {
    where.push(`a.category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  }
  if (articleIds.length) {
    where.push(`a.id IN (${articleIds.map(() => '?').join(',')})`);
    params.push(...articleIds);
  }

  const sql = `SELECT
      a.id AS faq_article_id,
      a.title AS source_title,
      a.category_id,
      v.id AS faq_version_id,
      v.search_text
    FROM faq_articles a
    INNER JOIN faq_article_versions v ON v.id = a.published_version_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.updated_at DESC
    LIMIT ?`;

  params.push(Math.max(1, Math.min(limit, QUESTION_GENERATION_MAX_SOURCES)));
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
};

const splitSentences = (text) => {
  const source = trimText(text).replace(/\s+/g, ' ');
  if (!source) return [];
  return source
    .split(/[。！？!?;；\n]/)
    .map((item) => trimText(item))
    .filter((item) => item.length >= 10)
    .slice(0, 6);
};

const buildRuleQuestions = ({ sourceTitle, searchText, tags = [] }) => {
  const sentences = splitSentences(searchText);
  const first = sentences[0] || trimText(searchText).slice(0, 60);
  const second = sentences[1] || first;
  const distractorA = '本文主要说明了与该主题无关的随机概念。';
  const distractorB = '此问题需要跳过原文，直接根据经验判断。';
  const distractorC = '以上都不正确。';

  return [
    {
      question_type: 'single_choice',
      difficulty: 'medium',
      stem: `关于《${sourceTitle}》的知识点，下列哪一项最符合原文描述？`,
      options: [
        { key: 'A', text: first },
        { key: 'B', text: distractorA },
        { key: 'C', text: distractorB },
        { key: 'D', text: distractorC },
      ],
      answer: ['A'],
      explanation: '正确项来自FAQ已发布内容。',
      tags,
      points: 2,
    },
    {
      question_type: 'fill_blank',
      difficulty: 'medium',
      stem: `${sourceTitle} 的关键内容可概括为：____。`,
      answer: trimText(second).slice(0, 80),
      answer_aliases: [trimText(second).slice(0, 40)],
      explanation: '请根据FAQ核心语句填写。',
      tags,
      points: 2,
    },
  ];
};

const resolveAiRuntime = async (taskType = 'FAQ_TO_QUESTIONS') => {
  const normalizedTaskType = trimText(taskType || 'FAQ_TO_QUESTIONS').toUpperCase();
  const model = await get('SELECT * FROM te_ai_models WHERE is_enabled = 1 AND is_default = 1 LIMIT 1');
  if (!model) throw appError('未找到可用AI模型', 400);

  const baseUrl = normalizeAiBaseUrlOrThrow(model.base_url || process.env.AI_OPENAI_BASE_URL);
  const apiKey = trimText(model.api_key || process.env.AI_OPENAI_API_KEY);
  const modelName = trimText(model.model_name || process.env.AI_MODEL_NAME);
  const timeoutMs = Math.max(3000, Number(model.timeout_ms || 20000));
  const maxTokens = Math.max(256, Number(model.max_tokens || 2048));
  const temperature = Number.isFinite(Number(model.temperature_default)) ? Number(model.temperature_default) : 0.3;

  if (!baseUrl || !apiKey || !modelName) {
    throw appError('模型配置不完整（base_url/api_key/model_name）', 400);
  }

  const promptRow = await get(
    'SELECT * FROM te_ai_prompts WHERE task_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
    [normalizedTaskType]
  );
  if (!promptRow) throw appError(`缺少 ${normalizedTaskType} 提示词`, 400);

  return {
    taskType: normalizedTaskType,
    model,
    baseUrl,
    apiKey,
    modelName,
    timeoutMs,
    maxTokens,
    temperature,
    promptTemplate: trimText(promptRow.prompt_template),
  };
};

const callOpenAiCompatible = async ({ runtime, inputText }) => {
  const endpoint = `${runtime.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: runtime.modelName,
    messages: [
      { role: 'system', content: runtime.promptTemplate },
      { role: 'user', content: inputText },
    ],
    temperature: runtime.temperature,
    max_tokens: runtime.maxTokens,
  };

  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    runtime.timeoutMs
  );
  const text = await response.text();
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    throw appError(`模型调用失败: HTTP ${response.status} ${text.slice(0, 180)}`, 400);
  }

  const parsed = parseMaybeJson(text, null);
  if (!parsed) throw appError('模型返回非JSON', 400);
  const content = trimText(parsed?.choices?.[0]?.message?.content);
  if (!content) throw appError('模型返回内容为空', 400);

  return {
    content,
    usage: parsed.usage || {},
    latencyMs,
  };
};

const testAiModelConnectivity = async ({ model, req }) => {
  const baseUrlRaw = trimText(model?.base_url || process.env.AI_OPENAI_BASE_URL);
  const apiKey = trimText(model?.api_key || process.env.AI_OPENAI_API_KEY);
  const modelName = trimText(model?.model_name || process.env.AI_MODEL_NAME);
  const timeoutMs = Math.max(3000, Math.min(120000, Number(model?.timeout_ms || 20000)));

  const modelId = Number(model?.id || 0) || null;
  const displayName = trimText(model?.name || model?.model_key || modelName || '未知模型');
  const requestIp = trimText(getClientIp(req)) || null;
  const operatorId = Number(req?.user?.id || 0) || null;
  const operatorName = trimText(req?.user?.username) || null;

  if (!baseUrlRaw || !apiKey || !modelName) {
    const message = '模型配置不完整（base_url/api_key/model_name）';
    await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, error_message, operator_id, operator_name, request_ip)
       VALUES ('MODEL_HEALTHCHECK', ?, ?, 'FAILED', 0, ?, ?, ?, ?)`,
      [modelId, displayName, message, operatorId, operatorName, requestIp]
    );
    return {
      available: false,
      status: 'FAILED',
      latency_ms: 0,
      reply_preview: '',
      error_message: message,
      checked_at: toMysqlDatetime(new Date()),
    };
  }

  const baseUrl = normalizeAiBaseUrlOrThrow(baseUrlRaw);

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: modelName,
    messages: [
      { role: 'system', content: '你是连通性测试助手。' },
      { role: 'user', content: '请仅回复：OK' },
    ],
    temperature: 0,
    max_tokens: 16,
  };

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
    const text = await response.text();
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) {
      const message = `模型调用失败: HTTP ${response.status} ${trimText(text).slice(0, 200)}`;
      await run(
        `INSERT INTO te_ai_task_logs
          (task_type, model_id, model_name, status, latency_ms, error_message, operator_id, operator_name, request_ip)
         VALUES ('MODEL_HEALTHCHECK', ?, ?, 'FAILED', ?, ?, ?, ?, ?)`,
        [modelId, displayName, latencyMs, message, operatorId, operatorName, requestIp]
      );
      return {
        available: false,
        status: 'FAILED',
        latency_ms: latencyMs,
        reply_preview: '',
        error_message: message,
        checked_at: toMysqlDatetime(new Date()),
      };
    }

    const parsed = parseMaybeJson(text, null);
    const content = trimText(parsed?.choices?.[0]?.message?.content);
    if (!parsed || !content) {
      const message = '模型返回格式异常或内容为空';
      await run(
        `INSERT INTO te_ai_task_logs
          (task_type, model_id, model_name, status, latency_ms, error_message, operator_id, operator_name, request_ip)
         VALUES ('MODEL_HEALTHCHECK', ?, ?, 'FAILED', ?, ?, ?, ?, ?)`,
        [modelId, displayName, latencyMs, message, operatorId, operatorName, requestIp]
      );
      return {
        available: false,
        status: 'FAILED',
        latency_ms: latencyMs,
        reply_preview: '',
        error_message: message,
        checked_at: toMysqlDatetime(new Date()),
      };
    }

    const usage = parsed?.usage || {};
    await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error_message, operator_id, operator_name, request_ip)
       VALUES ('MODEL_HEALTHCHECK', ?, ?, 'SUCCESS', ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        modelId,
        displayName,
        latencyMs,
        Number(usage?.prompt_tokens || 0),
        Number(usage?.completion_tokens || 0),
        Number(usage?.total_tokens || 0),
        operatorId,
        operatorName,
        requestIp,
      ]
    );
    return {
      available: true,
      status: 'SUCCESS',
      latency_ms: latencyMs,
      reply_preview: content.slice(0, 120),
      error_message: '',
      checked_at: toMysqlDatetime(new Date()),
    };
  } catch (err) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const message = trimText(err?.message || '模型连通性测试失败').slice(0, 2000);
    await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, error_message, operator_id, operator_name, request_ip)
       VALUES ('MODEL_HEALTHCHECK', ?, ?, 'FAILED', ?, ?, ?, ?, ?)`,
      [modelId, displayName, latencyMs, message, operatorId, operatorName, requestIp]
    );
    return {
      available: false,
      status: 'FAILED',
      latency_ms: latencyMs,
      reply_preview: '',
      error_message: message,
      checked_at: toMysqlDatetime(new Date()),
    };
  }
};

const parseAiQuestions = (payload) => {
  const raw = extractJsonCandidate(payload);
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : [];
  return items
    .map((item) => {
      const type = normalizeQuestionType(item?.question_type || item?.type, 'single_choice');
      const optionsRaw = Array.isArray(item?.options) ? item.options : [];
      const options = optionsRaw
        .map((opt, idx) => {
          if (typeof opt === 'string') return { key: String.fromCharCode(65 + idx), text: trimText(opt) };
          return {
            key: trimText(opt?.key || String.fromCharCode(65 + idx)).toUpperCase(),
            text: trimText(opt?.text || opt?.label || ''),
          };
        })
        .filter((opt) => opt.text)
        .slice(0, 8);

      const answerRaw = item?.answer;
      const answerArray = Array.isArray(answerRaw)
        ? answerRaw.map((v) => trimText(v).toUpperCase()).filter(Boolean)
        : trimText(answerRaw)
          ? [trimText(answerRaw).toUpperCase()]
          : [];

      return {
        question_type: type,
        difficulty: normalizeDifficulty(item?.difficulty, 'medium'),
        question_category: normalizeQuestionCategory(item?.question_category || item?.category, ''),
        stem: trimText(item?.stem || item?.question || ''),
        options,
        answer: answerArray,
        answer_text: trimText(item?.answer_text || (type === 'fill_blank' ? answerRaw : '')),
        answer_aliases: Array.isArray(item?.answer_aliases)
          ? item.answer_aliases.map((v) => trimText(v)).filter(Boolean)
          : [],
        explanation: trimText(item?.explanation || ''),
        tags: normalizeTags(item?.tags),
        points: Math.max(1, Number(item?.points || 2)),
      };
    })
    .filter((item) => item.stem)
    .filter((item) => {
      if (item.question_type === 'fill_blank') return !!(item.answer_text || item.answer.length);
      if (item.question_type === 'judgement') return item.answer.length > 0;
      return item.options.length >= 2 && item.answer.length > 0;
    });
};

const normalizeQuestionInput = (payload = {}, { defaultCategory = '未分类' } = {}) => {
  const questionType = normalizeQuestionType(payload.question_type, 'single_choice');
  const stem = trimText(payload.stem);
  if (!stem) throw appError('题干不能为空', 400);

  const difficulty = normalizeDifficulty(payload.difficulty, 'medium');
  const questionCategory = normalizeQuestionCategory(payload.question_category || payload.category, defaultCategory);
  const explanation = trimText(payload.explanation);
  const tags = normalizeTags(payload.tags);
  const points = Number.isFinite(Number(payload.points)) && Number(payload.points) > 0 ? Number(payload.points) : 2;

  let options = [];
  let answerValues = [];
  let answerText = '';
  let answerAliases = [];

  if (questionType === 'fill_blank') {
    const answerRawInput = payload.answer_values !== undefined ? payload.answer_values : payload.answer;
    const answerCandidates = Array.isArray(answerRawInput) ? answerRawInput : [answerRawInput];
    answerText = trimText(payload.answer_text || answerCandidates[0] || '');
    answerAliases = parseTextList(payload.answer_aliases, { upper: false });
    if (!answerText && !answerAliases.length) throw appError('填空题答案不能为空', 400);
    if (!answerText && answerAliases.length) answerText = answerAliases[0];
    answerValues = parseTextList([answerText, ...answerAliases], { upper: false });
  } else if (questionType === 'judgement') {
    const normalized = normalizeJudgementAnswer(payload.answer);
    if (!normalized) throw appError('判断题答案必须是 true/false', 400);
    options = [
      { key: 'A', text: '正确', is_correct: normalized === 'true' ? 1 : 0 },
      { key: 'B', text: '错误', is_correct: normalized === 'false' ? 1 : 0 },
    ];
    answerValues = [normalized];
  } else {
    const sourceOptions = Array.isArray(payload.options) ? payload.options : [];
    options = sourceOptions
      .map((item, idx) => {
        if (typeof item === 'string') {
          return {
            key: String.fromCharCode(65 + idx),
            text: trimText(item),
            is_correct: 0,
          };
        }
        return {
          key: trimText(item?.key || String.fromCharCode(65 + idx)).toUpperCase(),
          text: trimText(item?.text || item?.label || ''),
          is_correct: Number(item?.is_correct || 0) === 1 ? 1 : 0,
        };
      })
      .filter((item) => item.text)
      .slice(0, 8);

    if (options.length < 2) throw appError('客观题至少2个选项', 400);

    const answerRawInput = payload.answer_values !== undefined ? payload.answer_values : payload.answer;
    const answerRaw = Array.isArray(answerRawInput) ? answerRawInput : parseTextList(answerRawInput, { upper: true });
    answerValues = questionType === 'multiple_choice'
      ? normalizeMultipleChoiceAnswerValues(answerRaw)
      : parseTextList(answerRaw, { upper: true });

    if (!answerValues.length) {
      const inferred = options.filter((item) => item.is_correct === 1).map((item) => item.key);
      answerValues = inferred;
    }

    if (!answerValues.length) throw appError('客观题答案不能为空', 400);

    for (const opt of options) {
      opt.is_correct = answerValues.includes(opt.key) ? 1 : 0;
    }

    if (questionType === 'single_choice' && answerValues.length !== 1) {
      throw appError('单选题必须且仅能有一个正确答案', 400);
    }
  }

  return {
    stem,
    question_type: questionType,
    difficulty,
    question_category: questionCategory,
    explanation,
    tags,
    points,
    options,
    answer: {
      answer_values: answerValues,
      answer_text: answerText,
      answer_aliases: answerAliases,
    },
  };
};

const insertQuestion = async ({
  payload,
  user,
  sourceType = 'manual',
  generationJobId = null,
  courseId = null,
  status = 'draft',
  reviewer = null,
  reviewComment = '',
}) => {
  const normalized = normalizeQuestionInput(payload, {
    defaultCategory: getDefaultQuestionCategoryBySource(sourceType),
  });
  return transaction(async (tx) => {
    await upsertQuestionCategory({
      categoryName: normalized.question_category,
      user,
      isSystem: SYSTEM_QUESTION_CATEGORY_SET.has(normalized.question_category),
      tx,
    });

    const created = await tx.run(
      `INSERT INTO te_question_bank
        (course_id, source_type, generation_job_id, stem, question_type, difficulty, question_category, tags_json, status, explanation, points, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId || null,
        sourceType,
        generationJobId || null,
        normalized.stem,
        normalized.question_type,
        normalized.difficulty,
        normalized.question_category,
        JSON.stringify(normalized.tags),
        status,
        normalized.explanation || null,
        Number(normalized.points),
        Number(user?.id) || null,
        trimText(user?.username) || null,
        Number(user?.id) || null,
        trimText(user?.username) || null,
      ]
    );

    const questionId = Number(created.insertId || 0);

    for (let i = 0; i < normalized.options.length; i += 1) {
      const opt = normalized.options[i];
      await tx.run(
        `INSERT INTO te_question_options (question_id, option_key, option_text, is_correct, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [questionId, opt.key, opt.text, Number(opt.is_correct || 0), i]
      );
    }

    await tx.run(
      `INSERT INTO te_question_answers
        (question_id, answer_text, answer_values_text, answer_aliases_text, answer_json, answer_aliases_json)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      [
        questionId,
        normalized.answer.answer_text || null,
        toJoinedText(normalized.answer.answer_values || []),
        toJoinedText(normalized.answer.answer_aliases || []),
      ]
    );

    if (reviewer && trimText(status) === 'published') {
      await tx.run(
        `UPDATE te_question_bank
         SET reviewed_by_id = ?, reviewed_by_name = ?, review_comment = ?, reviewed_at = NOW(),
             updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          Number(reviewer.id) || null,
          trimText(reviewer.username) || null,
          trimText(reviewComment) || null,
          Number(user?.id) || null,
          trimText(user?.username) || null,
          questionId,
        ]
      );
      await tx.run(
        `INSERT INTO te_question_review_logs (question_id, action, comment, operator_id, operator_name)
         VALUES (?, 'approve', ?, ?, ?)`,
        [
          questionId,
          trimText(reviewComment) || '导入直接发布',
          Number(reviewer.id) || null,
          trimText(reviewer.username) || null,
        ]
      );
    }

    return questionId;
  });
};

const updateQuestion = async ({ questionId, payload, user, fallbackCategory = '未分类' }) => {
  const normalized = normalizeQuestionInput(payload, { defaultCategory: fallbackCategory });
  await transaction(async (tx) => {
    await upsertQuestionCategory({
      categoryName: normalized.question_category,
      user,
      isSystem: SYSTEM_QUESTION_CATEGORY_SET.has(normalized.question_category),
      tx,
    });

    await tx.run(
      `UPDATE te_question_bank
       SET stem = ?, question_type = ?, difficulty = ?, question_category = ?, tags_json = ?, explanation = ?, points = ?,
           updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        normalized.stem,
        normalized.question_type,
        normalized.difficulty,
        normalized.question_category,
        JSON.stringify(normalized.tags),
        normalized.explanation || null,
        Number(normalized.points),
        Number(user?.id) || null,
        trimText(user?.username) || null,
        Number(questionId),
      ]
    );

    await tx.run('DELETE FROM te_question_options WHERE question_id = ?', [Number(questionId)]);
    await tx.run('DELETE FROM te_question_answers WHERE question_id = ?', [Number(questionId)]);

    for (let i = 0; i < normalized.options.length; i += 1) {
      const opt = normalized.options[i];
      await tx.run(
        `INSERT INTO te_question_options (question_id, option_key, option_text, is_correct, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [Number(questionId), opt.key, opt.text, Number(opt.is_correct || 0), i]
      );
    }

    await tx.run(
      `INSERT INTO te_question_answers
        (question_id, answer_text, answer_values_text, answer_aliases_text, answer_json, answer_aliases_json)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      [
        Number(questionId),
        normalized.answer.answer_text || null,
        toJoinedText(normalized.answer.answer_values || []),
        toJoinedText(normalized.answer.answer_aliases || []),
      ]
    );
  });
};

const deleteQuestionCascade = async ({ questionId, force = false }) => {
  const id = Number(questionId || 0);
  const before = await getQuestionById(id);
  if (!before) throw appError('题目不存在', 404);

  const paperRef = await get('SELECT COUNT(1) AS total FROM te_paper_questions WHERE question_id = ?', [id]);
  const refTotal = Number(paperRef?.total || 0);
  if (!force && refTotal > 0) {
    throw appError('题目已被试卷引用，请使用强制删除', 409);
  }

  let removedPaperBindings = 0;
  if (refTotal > 0) {
    const removed = await run('DELETE FROM te_paper_questions WHERE question_id = ?', [id]);
    removedPaperBindings = Number(removed?.affectedRows || 0);
  }

  await transaction(async (tx) => {
    await tx.run('DELETE FROM te_question_options WHERE question_id = ?', [id]);
    await tx.run('DELETE FROM te_question_answers WHERE question_id = ?', [id]);
    await tx.run('DELETE FROM te_question_review_logs WHERE question_id = ?', [id]);
    await tx.run('DELETE FROM te_question_bank WHERE id = ?', [id]);
  });

  return { before, removedPaperBindings };
};

const deletePaperCascade = async ({ paperId, force = false }) => {
  const id = Number(paperId || 0);
  const before = await loadPaperDetail(id);
  if (!before) throw appError('试卷不存在', 404);

  const refRow = await get(
    `SELECT
      (SELECT COUNT(1) FROM te_exam_sessions WHERE paper_id = ?) AS session_total,
      (SELECT COUNT(1) FROM te_exam_results WHERE paper_id = ?) AS result_total,
      (SELECT COUNT(1) FROM te_recertification_jobs WHERE paper_id = ?) AS recert_total`,
    [id, id, id]
  );
  const sessionTotal = Number(refRow?.session_total || 0);
  const resultTotal = Number(refRow?.result_total || 0);
  const recertTotal = Number(refRow?.recert_total || 0);
  const refTotal = sessionTotal + resultTotal + recertTotal;

  if (!force && refTotal > 0) {
    throw appError('试卷存在考试记录或复考任务，请使用强制删除', 409);
  }

  const certRows = await query(
    `SELECT c.id, c.file_path
     FROM te_certificates c
     INNER JOIN te_exam_results r ON r.id = c.result_id
     WHERE r.paper_id = ?`,
    [id]
  );

  const removal = await transaction(async (tx) => {
    const removedAnswers = await tx.run(
      `DELETE ea
       FROM te_exam_answers ea
       INNER JOIN te_exam_sessions s ON s.id = ea.session_id
       WHERE s.paper_id = ?`,
      [id]
    );
    const removedAdvices = await tx.run(
      `DELETE a
       FROM te_result_ai_advices a
       INNER JOIN te_exam_results r ON r.id = a.result_id
       WHERE r.paper_id = ?`,
      [id]
    );
    const removedCertificates = await tx.run(
      `DELETE c
       FROM te_certificates c
       INNER JOIN te_exam_results r ON r.id = c.result_id
       WHERE r.paper_id = ?`,
      [id]
    );
    const removedRecertJobs = await tx.run('DELETE FROM te_recertification_jobs WHERE paper_id = ?', [id]);
    const removedResults = await tx.run('DELETE FROM te_exam_results WHERE paper_id = ?', [id]);
    const removedSessions = await tx.run('DELETE FROM te_exam_sessions WHERE paper_id = ?', [id]);
    const removedRules = await tx.run('DELETE FROM te_paper_question_rules WHERE paper_id = ?', [id]);
    const removedFixedQuestions = await tx.run('DELETE FROM te_paper_questions WHERE paper_id = ?', [id]);
    const removedPaper = await tx.run('DELETE FROM te_papers WHERE id = ?', [id]);

    if (Number(removedPaper?.affectedRows || 0) <= 0) {
      throw appError('试卷不存在', 404);
    }

    return {
      removedAnswers: Number(removedAnswers?.affectedRows || 0),
      removedAdvices: Number(removedAdvices?.affectedRows || 0),
      removedCertificates: Number(removedCertificates?.affectedRows || 0),
      removedRecertJobs: Number(removedRecertJobs?.affectedRows || 0),
      removedResults: Number(removedResults?.affectedRows || 0),
      removedSessions: Number(removedSessions?.affectedRows || 0),
      removedRules: Number(removedRules?.affectedRows || 0),
      removedFixedQuestions: Number(removedFixedQuestions?.affectedRows || 0),
    };
  });

  let removedCertificateFiles = 0;
  for (const row of certRows) {
    const removed = await removeCertificateFileIfExists(row?.file_path);
    if (removed) removedCertificateFiles += 1;
  }

  return {
    before,
    removedAnswers: removal.removedAnswers,
    removedAdvices: removal.removedAdvices,
    removedCertificates: removal.removedCertificates,
    removedCertificateFiles,
    removedRecertJobs: removal.removedRecertJobs,
    removedResults: removal.removedResults,
    removedSessions: removal.removedSessions,
    removedRules: removal.removedRules,
    removedFixedQuestions: removal.removedFixedQuestions,
  };
};

const getQuestionById = async (questionId) => {
  const question = await get('SELECT * FROM te_question_bank WHERE id = ? LIMIT 1', [Number(questionId)]);
  if (!question) return null;
  const options = await query(
    'SELECT option_key, option_text, is_correct, sort_order FROM te_question_options WHERE question_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(questionId)]
  );
  const answerRow = await get('SELECT * FROM te_question_answers WHERE question_id = ? LIMIT 1', [Number(questionId)]);

  return {
    ...question,
    tags: parseMaybeJson(question.tags_json, []),
    meta: parseMaybeJson(question.meta_json, {}),
    options: Array.isArray(options)
      ? options.map((item) => ({
          key: trimText(item.option_key),
          text: trimText(item.option_text),
          is_correct: Number(item.is_correct || 0),
          sort_order: Number(item.sort_order || 0),
        }))
      : [],
    answer: {
      answer_text: trimText(answerRow?.answer_text),
      answer_values: parseStoredAnswerValues(answerRow),
      answer_aliases: parseStoredAnswerAliases(answerRow),
    },
  };
};

const buildQuestionSnapshot = async (questionId, pointsOverride = null) => {
  const item = await getQuestionById(questionId);
  if (!item) throw appError(`题目不存在: ${questionId}`, 404);
  const snapshot = {
    question_id: Number(item.id),
    stem: trimText(item.stem),
    question_type: normalizeQuestionType(item.question_type, 'single_choice'),
    difficulty: normalizeDifficulty(item.difficulty, 'medium'),
    question_category: normalizeQuestionCategory(item.question_category, '未分类'),
    explanation: trimText(item.explanation),
    tags: Array.isArray(item.tags) ? item.tags : [],
    points: Number.isFinite(Number(pointsOverride)) && Number(pointsOverride) > 0 ? Number(pointsOverride) : Number(item.points || 1),
    options: (item.options || []).map((opt) => ({ key: opt.key, text: opt.text })),
    standard_answer: {
      answer_values: parseTextList(item.answer?.answer_values, { upper: false }),
      answer_text: trimText(item.answer?.answer_text),
      answer_aliases: parseTextList(item.answer?.answer_aliases, { upper: false }),
      question_type: normalizeQuestionType(item.question_type, 'single_choice'),
    },
  };
  return snapshot;
};

const hideStandardAnswer = (snapshot) => {
  const clone = { ...snapshot };
  delete clone.standard_answer;
  return clone;
};

const toQuestionTypeCn = (value) => {
  const type = normalizeQuestionType(value, 'single_choice');
  if (type === 'single_choice') return '单选题';
  if (type === 'multiple_choice') return '多选题';
  if (type === 'judgement') return '判断题';
  if (type === 'fill_blank') return '填空题';
  return type;
};

const ensureExamSessionAccess = (req, sessionRow, { allowAuditRead = false } = {}) => {
  if (!sessionRow) throw appError('考试会话不存在', 404);
  const uid = Number(req.user?.id || 0);
  const ownerId = Number(sessionRow.user_id || 0);
  const isOwner = uid > 0 && uid === ownerId;
  const isAudit = allowAuditRead && (isAdmin(req) || isAuditor(req));
  if (!isOwner && !isAudit) throw appError('无权限访问该考试会话', 403);
  return { isOwner, isAudit };
};

const ensureResultAccess = (req, resultRow, { allowAuditRead = true } = {}) => {
  if (!resultRow) throw appError('成绩记录不存在', 404);
  const uid = Number(req.user?.id || 0);
  const ownerId = Number(resultRow.user_id || 0);
  const isOwner = uid > 0 && uid === ownerId;
  const isAudit = allowAuditRead && (isAdmin(req) || isAuditor(req));
  if (!isOwner && !isAudit) throw appError('无权限访问该成绩记录', 403);
  return { isOwner, isAudit };
};

const resolveResultPaperName = (row = {}) => {
  const paperId = Number(row?.paper_id || 0);
  const name = trimText(row?.paper_name);
  if (name) return name;
  if (paperId === 0) return '错题复训';
  return paperId > 0 ? `试卷#${paperId}` : '未命名试卷';
};

const buildWrongCountFromResult = (row = {}) => {
  const detail = parseMaybeJson(row?.detail_json, {});
  const details = Array.isArray(detail?.details) ? detail.details : [];
  return details.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.is_correct === 'boolean') return !item.is_correct;
    return Number(item.is_correct || 0) !== 1;
  }).length;
};

const normalizeAdminResultRow = (row = {}) => {
  const normalized = normalizeAdminResultListRow({
    ...row,
    wrong_count: buildWrongCountFromResult(row),
  });
  return {
    ...normalized,
    paper_name: resolveResultPaperName(row),
    username: trimText(row.username),
    user_department: trimText(row.user_department),
    user_position: trimText(row.user_position),
    created_at: row.created_at,
  };
};

const pad2 = (value) => String(value).padStart(2, '0');
const buildResultsExportFilename = (prefix, date = new Date()) => {
  const current = date instanceof Date ? date : new Date(date);
  return `${prefix}-${current.getFullYear()}-${pad2(current.getMonth() + 1)}-${pad2(current.getDate())}-${pad2(current.getHours())}-${pad2(current.getMinutes())}-${pad2(current.getSeconds())}.csv`;
};

const buildAdminResultUserOptions = async ({ whereSql, params }) => {
  const rows = await query(
    `SELECT
      r.user_id,
      MAX(r.username) AS username,
      MAX(NULLIF(r.user_department, '')) AS user_department,
      MAX(r.created_at) AS latest_created_at
     FROM te_exam_results r
     LEFT JOIN te_papers p ON p.id = r.paper_id
     ${whereSql}
     GROUP BY r.user_id
     ORDER BY latest_created_at DESC
     LIMIT 100`,
    params
  );
  return rows.map((item) => ({
    user_id: Number(item.user_id || 0),
    username: trimText(item.username),
    user_department: trimText(item.user_department),
  })).filter((item) => item.user_id > 0);
};

const buildAdminResultPaperOptions = async ({ whereSql, params }) => {
  const rows = await query(
    `SELECT
      r.paper_id,
      MAX(p.name) AS paper_name,
      MAX(r.created_at) AS latest_created_at
     FROM te_exam_results r
     LEFT JOIN te_papers p ON p.id = r.paper_id
     ${whereSql}
     GROUP BY r.paper_id
     ORDER BY latest_created_at DESC
     LIMIT 100`,
    params
  );
  return rows.map((item) => ({
    paper_id: Number(item.paper_id || 0),
    paper_name: resolveResultPaperName(item),
  })).filter((item) => Number(item.paper_id || 0) >= 0);
};

const getAvailableRetakeOpportunity = async ({ userId, paperId, tx = null } = {}) => {
  const db = tx || { get };
  return db.get(
    `SELECT *
     FROM te_exam_retake_opportunities
     WHERE user_id = ? AND paper_id = ? AND remaining_count > consumed_count
     ORDER BY id ASC
     LIMIT 1`,
    [Number(userId || 0), Number(paperId || 0)]
  );
};

const consumeRetakeOpportunity = async ({ tx, opportunityId } = {}) => {
  const id = Number(opportunityId || 0);
  if (!id) return false;
  const result = await tx.run(
    `UPDATE te_exam_retake_opportunities
     SET consumed_count = consumed_count + 1, updated_at = NOW()
     WHERE id = ? AND remaining_count > consumed_count`,
    [id]
  );
  return Number(result?.affectedRows || 0) > 0;
};

const grantRetakeOpportunity = async ({
  tx = null,
  paperId,
  userId,
  username,
  reason,
  grantedBy,
} = {}) => {
  const db = tx || { run };
  const result = await db.run(
    `INSERT INTO te_exam_retake_opportunities
      (paper_id, user_id, username, remaining_count, consumed_count, reason, granted_by_id, granted_by_name)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?)`,
    [
      Number(paperId || 0),
      Number(userId || 0),
      trimText(username || `用户#${Number(userId || 0)}`),
      trimText(reason).slice(0, 255) || null,
      Number(grantedBy?.id || 0) || null,
      trimText(grantedBy?.username) || null,
    ]
  );
  return {
    id: Number(result?.insertId || 0),
    paper_id: Number(paperId || 0),
    user_id: Number(userId || 0),
    username: trimText(username || `用户#${Number(userId || 0)}`),
    remaining_count: 1,
    consumed_count: 0,
    reason: trimText(reason),
  };
};

const loadRetakeTarget = async ({ userId, paperId }) => {
  const [paper, profile, latestResult, latestSession] = await Promise.all([
    get('SELECT id, name FROM te_papers WHERE id = ? LIMIT 1', [Number(paperId || 0)]),
    get('SELECT user_id, username FROM te_user_profiles WHERE user_id = ? LIMIT 1', [Number(userId || 0)]),
    get(
      `SELECT user_id, username
       FROM te_exam_results
       WHERE user_id = ? AND paper_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [Number(userId || 0), Number(paperId || 0)]
    ),
    get(
      `SELECT user_id, username
       FROM te_exam_sessions
       WHERE user_id = ? AND paper_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [Number(userId || 0), Number(paperId || 0)]
    ),
  ]);
  if (!paper) throw appError('试卷不存在', 404);
  const username = trimText(profile?.username || latestResult?.username || latestSession?.username || `用户#${Number(userId || 0)}`);
  return {
    paper,
    user: {
      id: Number(userId || 0),
      username,
    },
  };
};

const finalizeExamSession = async ({ sessionId, forceTimeout = false, req = null }) => {
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [Number(sessionId)]);
  if (!session) throw appError('考试会话不存在', 404);

  if (['submitted', 'timeout'].includes(trimText(session.status).toLowerCase())) {
    const existed = await get('SELECT * FROM te_exam_results WHERE session_id = ? LIMIT 1', [Number(sessionId)]);
    if (existed) return existed;
  }

  const answers = await query(
    'SELECT * FROM te_exam_answers WHERE session_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(sessionId)]
  );

  let score = 0;
  let totalScore = 0;
  const details = [];

  await transaction(async (tx) => {
    for (const answer of answers) {
      const snapshot = parseMaybeJson(answer.question_snapshot_json, {});
      const standardAnswer = parseMaybeJson(answer.standard_answer_json, {});
      const userAnswer = parseMaybeJson(answer.user_answer_json, null);
      const points = Number(snapshot?.points || 0);
      totalScore += points;

      const evaluated = evaluateAnswer({
        snapshot,
        standardAnswer,
        userAnswer,
      });

      score += Number(evaluated.earnedScore || 0);
      details.push({
        question_id: Number(answer.question_id || 0),
        stem: trimText(snapshot?.stem),
        question_type: snapshot?.question_type,
        points,
        earned_score: Number(evaluated.earnedScore || 0),
        is_correct: !!evaluated.isCorrect,
        user_answer: userAnswer,
        standard_answer: standardAnswer,
        explanation: trimText(snapshot?.explanation),
      });

      await tx.run(
        `UPDATE te_exam_answers
         SET is_correct = ?, earned_score = ?, updated_at = NOW()
         WHERE id = ?`,
        [evaluated.isCorrect ? 1 : 0, Number(evaluated.earnedScore || 0), Number(answer.id)]
      );
    }

    const passed = Number(score) >= Number(session.pass_score || 80) ? 1 : 0;
    const nextStatus = forceTimeout ? 'timeout' : 'submitted';
    const endedAt = toMysqlDatetime(new Date());

    await tx.run(
      `UPDATE te_exam_sessions
       SET status = ?, ended_at = ?, submitted_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextStatus, endedAt, endedAt, Number(sessionId)]
    );

    await tx.run(
      `UPDATE te_exam_results
       SET is_final = 0
       WHERE user_id = ? AND paper_id = ?`,
      [Number(session.user_id), Number(session.paper_id)]
    );

    await tx.run(
      `INSERT INTO te_exam_results
        (session_id, paper_id, user_id, username, user_department, user_position, attempt_no, score, total_score, passed, is_final, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        Number(sessionId),
        Number(session.paper_id),
        Number(session.user_id),
        trimText(session.username),
        normalizeOrgLabel(session.user_department),
        normalizeOrgLabel(session.user_position),
        Number(session.attempt_no || 1),
        Number(score.toFixed(2)),
        Number(totalScore.toFixed(2)),
        passed,
        JSON.stringify({
          score: Number(score.toFixed(2)),
          total_score: Number(totalScore.toFixed(2)),
          pass_score: Number(session.pass_score || 80),
          details,
          finalized_at: endedAt,
          finalized_as: nextStatus,
        }),
      ]
    );
  });

  const result = await get('SELECT * FROM te_exam_results WHERE session_id = ? LIMIT 1', [Number(sessionId)]);
  await markRecertificationCompleted({
    userId: Number(session.user_id),
    paperId: Number(session.paper_id),
    resultId: Number(result?.id || 0),
    passed: Number(result?.passed || 0),
  });

  if (req) {
    await logOperation({
      req,
      action: forceTimeout ? 'EXAM_TIMEOUT_SUBMIT' : 'EXAM_SUBMIT',
      entity: 'exam_session',
      entityId: Number(sessionId),
      message: `提交考试会话 ${sessionId}`,
      afterData: result,
    });
  }

  return result;
};

const buildWrongQuestionAction = (questionType) => {
  const qType = normalizeQuestionType(questionType, 'single_choice');
  if (qType === 'multiple_choice') {
    return '建议先回看相关资料，再进行多选专项重练（全集匹配）';
  }
  if (qType === 'fill_blank') {
    return '建议整理关键词并进行填空专项重练（注意同义词）';
  }
  if (qType === 'judgement') {
    return '建议复核判断依据并完成判断题专项训练';
  }
  return '建议回看知识点后完成单选专项训练';
};

const buildWrongQuestionNotebook = async ({ userId, page = 1, limit = 20, historyScanLimit = 5000 }) => {
  const uid = Number(userId || 0);
  if (!uid) {
    return {
      items: [],
      all_items: [],
      summary: {
        wrong_question_total: 0,
        unresolved_total: 0,
        improved_total: 0,
        top_tags: [],
        difficulty_dist: [],
      },
      pagination: { page: 1, limit: 20, total: 0, total_pages: 0 },
    };
  }

  const scanLimit = Math.max(200, Math.min(10000, toPositiveInt(historyScanLimit, 5000)));
  const rows = await query(
    `SELECT
      ea.id,
      ea.question_id,
      ea.question_snapshot_json,
      ea.standard_answer_json,
      ea.user_answer_json,
      ea.is_correct,
      ea.updated_at,
      s.id AS session_id,
      s.paper_id,
      s.attempt_no
     FROM te_exam_answers ea
     INNER JOIN te_exam_sessions s ON s.id = ea.session_id
     WHERE s.user_id = ? AND s.status IN ('submitted', 'timeout')
     ORDER BY ea.updated_at DESC, ea.id DESC
     LIMIT ?`,
    [uid, scanLimit]
  );

  const grouped = new Map();

  for (const row of rows) {
    const questionId = Number(row.question_id || 0);
    if (!questionId) continue;
    const snapshot = parseMaybeJson(row.question_snapshot_json, {});
    const isCorrect = Number(row.is_correct || 0) === 1;

    let item = grouped.get(questionId);
    if (!item) {
      item = {
        question_id: questionId,
        stem: trimText(snapshot?.stem),
        question_type: normalizeQuestionType(snapshot?.question_type, 'single_choice'),
        difficulty: normalizeDifficulty(snapshot?.difficulty, 'medium'),
        tags: normalizeTags(snapshot?.tags),
        wrong_count: 0,
        correct_count: 0,
        latest_wrong_at: '',
        latest_correct_at: '',
        latest_wrong_session_id: null,
        latest_wrong_paper_id: null,
        latest_wrong_attempt_no: null,
        latest_wrong_user_answer: [],
        latest_wrong_standard_answer: {},
      };
      grouped.set(questionId, item);
    }

    if (isCorrect) {
      item.correct_count += 1;
      if (!item.latest_correct_at) {
        item.latest_correct_at = trimText(row.updated_at);
      }
      continue;
    }

    item.wrong_count += 1;
    if (!item.latest_wrong_at) {
      item.latest_wrong_at = trimText(row.updated_at);
      item.latest_wrong_session_id = Number(row.session_id || 0) || null;
      item.latest_wrong_paper_id = Number(row.paper_id || 0) || null;
      item.latest_wrong_attempt_no = Number(row.attempt_no || 0) || null;
      item.latest_wrong_user_answer = parseMaybeJson(row.user_answer_json, []);
      item.latest_wrong_standard_answer = parseMaybeJson(row.standard_answer_json, {});
    }
  }

  const allItems = Array.from(grouped.values())
    .filter((item) => Number(item.wrong_count || 0) > 0)
    .map((item) => {
      const wrongTs = parseDate(item.latest_wrong_at)?.getTime() || 0;
      const correctTs = parseDate(item.latest_correct_at)?.getTime() || 0;
      const improved = correctTs > wrongTs;
      return {
        ...item,
        mastery_status: improved ? 'improved' : 'needs_review',
        suggested_action: buildWrongQuestionAction(item.question_type),
      };
    })
    .sort((a, b) => {
      const ta = parseDate(a.latest_wrong_at)?.getTime() || 0;
      const tb = parseDate(b.latest_wrong_at)?.getTime() || 0;
      return tb - ta;
    });

  const tagCounter = new Map();
  const difficultyCounter = new Map();
  let unresolvedTotal = 0;
  let improvedTotal = 0;

  for (const item of allItems) {
    if (item.mastery_status === 'improved') improvedTotal += 1;
    else unresolvedTotal += 1;
    difficultyCounter.set(item.difficulty, Number(difficultyCounter.get(item.difficulty) || 0) + 1);
    for (const tag of item.tags) {
      tagCounter.set(tag, Number(tagCounter.get(tag) || 0) + 1);
    }
  }

  const topTags = Array.from(tagCounter.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const difficultyDist = Array.from(difficultyCounter.entries())
    .map(([difficulty, count]) => ({ difficulty, count }))
    .sort((a, b) => b.count - a.count);

  const safeLimit = Math.max(1, Math.min(200, toBoundedLimit(limit, 20)));
  const safePage = Math.max(1, toPositiveInt(page, 1));
  const total = allItems.length;
  const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;
  const offset = (safePage - 1) * safeLimit;
  const items = allItems.slice(offset, offset + safeLimit);

  return {
    items,
    all_items: allItems,
    summary: {
      wrong_question_total: total,
      unresolved_total: unresolvedTotal,
      improved_total: improvedTotal,
      top_tags: topTags,
      difficulty_dist: difficultyDist,
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: totalPages,
    },
  };
};

const buildRetrainRecommendations = async ({ userId, limit = 6 }) => {
  const notebook = await buildWrongQuestionNotebook({
    userId,
    page: 1,
    limit: 200,
    historyScanLimit: 8000,
  });
  const unresolvedItems = notebook.all_items.filter((item) => item.mastery_status !== 'improved');
  const topTags = (notebook.summary.top_tags || []).map((item) => trimText(item.tag)).filter(Boolean).slice(0, 6);
  const recommendationLimit = Math.max(1, Math.min(10, toPositiveInt(limit, 6)));

  const courseRows = await query(
    `SELECT id, title, description, duration_minutes, updated_at
     FROM te_courses
     WHERE is_active = 1
     ORDER BY updated_at DESC
     LIMIT 200`
  );

  const scoredCourses = courseRows
    .map((course) => {
      const text = `${trimText(course.title)} ${trimText(course.description)}`.toLowerCase();
      const matchedTags = topTags.filter((tag) => text.includes(tag.toLowerCase()));
      const score = matchedTags.length;
      return {
        ...course,
        match_score: score,
        matched_tags: matchedTags,
      };
    })
    .sort((a, b) => {
      if (b.match_score !== a.match_score) return b.match_score - a.match_score;
      const ta = parseDate(a.updated_at)?.getTime() || 0;
      const tb = parseDate(b.updated_at)?.getTime() || 0;
      return tb - ta;
    });

  const selectedCourses = scoredCourses
    .filter((item) => item.match_score > 0)
    .slice(0, recommendationLimit);
  const fallbackCourses = scoredCourses
    .filter((item) => item.match_score === 0)
    .slice(0, Math.max(0, recommendationLimit - selectedCourses.length));
  const finalCourses = [...selectedCourses, ...fallbackCourses].slice(0, recommendationLimit);

  const recommendations = [
    {
      recommendation_type: 'practice_pack',
      title: '错题再练习',
      reason: unresolvedItems.length
        ? `当前仍有 ${unresolvedItems.length} 道错题未掌握，建议先完成一轮错题重做。`
        : '当前错题均已改善，建议每周做一次巩固练习。',
      target_question_count: Math.min(20, Math.max(5, unresolvedItems.length || 5)),
    },
  ];

  for (const course of finalCourses) {
    const resources = await query(
      `SELECT id, name, resource_type, source_mode, storage_backend, upload_status, source_url, force_watch
       FROM te_course_resources
       WHERE course_id = ?
       ORDER BY id DESC
       LIMIT 3`,
      [Number(course.id)]
    );

    recommendations.push({
      recommendation_type: 'course',
      course_id: Number(course.id),
      course_title: trimText(course.title),
      duration_minutes: Number(course.duration_minutes || 0),
      reason: course.matched_tags.length
        ? `匹配错题标签：${course.matched_tags.join('、')}`
        : '建议补充该课程内容后再进行错题重练',
      match_score: Number(course.match_score || 0),
        resource_preview: resources.map((item) => ({
          id: Number(item.id || 0),
          name: trimText(item.name),
          resource_type: trimText(item.resource_type),
          source_mode: trimText(item.source_mode),
          storage_backend: resolveStorageBackend({
            sourceMode: item.source_mode,
            requested: item.storage_backend,
            fallback: normalizeSourceMode(item.source_mode) === 'external' ? 'external' : 'local',
          }),
          upload_status: normalizeUploadStatus(item.upload_status, trimText(item.source_url) ? 'ready' : 'pending'),
          force_watch: Number(item.force_watch || 0) === 1,
          source_url: trimText(item.source_url),
        })),
    });
  }

  return {
    summary: {
      wrong_question_total: Number(notebook.summary.wrong_question_total || 0),
      unresolved_total: Number(notebook.summary.unresolved_total || 0),
      improved_total: Number(notebook.summary.improved_total || 0),
      top_tags: notebook.summary.top_tags || [],
      generated_at: toMysqlDatetime(new Date()),
    },
    recommendations,
  };
};

const clampProgressPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Number(n.toFixed(2))));
};

const addDays = (date, days) => {
  const base = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const duration = Math.max(0, Number(days || 0));
  return new Date(base.getTime() + duration * 24 * 60 * 60 * 1000);
};

const resolveCertificateValidity = ({ issuedAt, validFrom, validUntil, validityDays }) => {
  const effectiveDays = Math.max(30, Math.min(3650, Number(validityDays || CERT_VALIDITY_DAYS_DEFAULT)));
  const issuedDate = parseDate(issuedAt) || new Date();
  const fromDate = parseDate(validFrom) || issuedDate;
  const untilDate = parseDate(validUntil) || addDays(fromDate, effectiveDays);
  return {
    effective_days: effectiveDays,
    valid_from: toMysqlDatetime(fromDate),
    valid_until: toMysqlDatetime(untilDate),
    until_date: untilDate,
  };
};

const getResourceProgressRow = async ({ userId, resourceId }) =>
  get(
    `SELECT *
     FROM te_resource_progress
     WHERE user_id = ? AND resource_id = ?
     LIMIT 1`,
    [Number(userId || 0), Number(resourceId || 0)]
  );

const buildCourseLearningPath = async ({ courseId, userId }) => {
  const cid = Number(courseId || 0);
  const uid = Number(userId || 0);
  const course = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [cid]);
  if (!course) throw appError('课程不存在', 404);

  const resources = await query(
    `SELECT *
     FROM te_course_resources
     WHERE course_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [cid]
  );
  const progressRows = await query(
    `SELECT *
     FROM te_resource_progress
     WHERE course_id = ? AND user_id = ?`,
    [cid, uid]
  );
  const progressMap = new Map(progressRows.map((row) => [Number(row.resource_id || 0), row]));

  const items = resources.map((resource, idx) => {
    const progress = progressMap.get(Number(resource.id || 0));
    const progressPercent = clampProgressPercent(progress?.progress_percent || 0);
    return {
      id: Number(resource.id || 0),
      chapter_no: idx + 1,
      sort_order: Number(resource.sort_order || 0),
      name: trimText(resource.name),
      resource_type: trimText(resource.resource_type),
      source_mode: trimText(resource.source_mode),
      storage_backend: resolveStorageBackend({
        sourceMode: resource.source_mode,
        requested: resource.storage_backend,
        fallback: normalizeSourceMode(resource.source_mode) === 'external' ? 'external' : 'local',
      }),
      upload_status: normalizeUploadStatus(
        resource.upload_status,
        trimText(resource.source_url) || trimText(resource.storage_path) || trimText(resource.object_key) ? 'ready' : 'pending'
      ),
      force_watch: Number(resource.force_watch || 0) === 1,
      source_url: trimText(resource.source_url),
      mime_type: trimText(resource.mime_type),
      file_size: Number(resource.file_size || 0),
      has_file: normalizeSourceMode(resource.source_mode) === 'external'
        ? false
        : resolveStorageBackend({
          sourceMode: resource.source_mode,
          requested: resource.storage_backend,
          fallback: 'local',
        }) === 'oss'
          ? normalizeUploadStatus(resource.upload_status) === 'ready' && !!trimText(resource.object_key)
          : !!trimText(resource.storage_path),
      transcode_status: normalizeTranscodeStatus(resource.transcode_status, 'none'),
      transcode_progress: Math.max(0, Math.min(100, Number(resource.transcode_progress || 0))),
      transcode_message: trimText(resource.transcode_message),
      transcode_job_id: Number(resource.transcode_job_id || 0) || null,
      updated_at: resource.updated_at || null,
      duration_seconds: Number(resource.duration_seconds || 0),
      progress: {
        progress_percent: progressPercent,
        viewed_seconds: Number(progress?.viewed_seconds || 0),
        last_position_seconds: Number(progress?.last_position_seconds || 0),
        completed: isProgressCompleted({
          progressPercent,
          completedAt: progress?.completed_at || null,
        }),
        completed_at: progress?.completed_at || null,
        updated_at: progress?.updated_at || null,
      },
    };
  });

  const completed = items.filter((item) => item.progress.completed).length;
  const inProgress = items.filter((item) => !item.progress.completed && Number(item.progress.progress_percent || 0) > 0).length;

  return {
    course: {
      id: Number(course.id || 0),
      title: trimText(course.title),
      description: trimText(course.description),
    },
    summary: {
      total_resources: items.length,
      completed_resources: completed,
      in_progress_resources: inProgress,
      not_started_resources: Math.max(0, items.length - completed - inProgress),
      completion_rate: items.length > 0 ? Number(((completed / items.length) * 100).toFixed(2)) : 0,
    },
    items,
  };
};

const buildMyLearningProgress = async ({ userId, role }) => {
  const uid = Number(userId || 0);
  const where = [];
  const params = [uid];
  if (!canReadCourse({ role, courseStatus: 'draft' })) {
    where.push("c.status = 'published'");
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT
      c.id AS course_id,
      c.title AS course_title,
      COUNT(r.id) AS total_resources,
      SUM(CASE WHEN rp.completed_at IS NOT NULL OR IFNULL(rp.progress_percent, 0) >= 100 THEN 1 ELSE 0 END) AS completed_resources,
      SUM(CASE WHEN IFNULL(rp.progress_percent, 0) > 0 AND (rp.completed_at IS NULL AND IFNULL(rp.progress_percent, 0) < 100) THEN 1 ELSE 0 END) AS in_progress_resources,
      MAX(rp.updated_at) AS last_learning_at
     FROM te_courses c
     LEFT JOIN te_course_resources r ON r.course_id = c.id
     LEFT JOIN te_resource_progress rp ON rp.resource_id = r.id AND rp.user_id = ?
     ${whereSql}
     GROUP BY c.id, c.title
     ORDER BY last_learning_at DESC, c.id DESC`,
    params
  );

  return rows.map((item) => {
    const total = Number(item.total_resources || 0);
    const completed = Number(item.completed_resources || 0);
    return {
      course_id: Number(item.course_id || 0),
      course_title: trimText(item.course_title),
      total_resources: total,
      completed_resources: completed,
      in_progress_resources: Number(item.in_progress_resources || 0),
      completion_rate: total > 0 ? Number(((completed / total) * 100).toFixed(2)) : 0,
      last_learning_at: item.last_learning_at,
    };
  });
};

const buildCertificatesWithStatus = async ({ userId }) => {
  const uid = Number(userId || 0);
  const rows = await query(
    `SELECT
      c.*,
      r.paper_id,
      r.score,
      r.total_score,
      r.user_id,
      p.name AS paper_name
     FROM te_certificates c
     INNER JOIN te_exam_results r ON r.id = c.result_id
     LEFT JOIN te_papers p ON p.id = r.paper_id
     WHERE r.user_id = ?
     ORDER BY c.id DESC`,
    [uid]
  );

  const now = new Date();
  const output = [];

  for (const row of rows) {
    const validity = resolveCertificateValidity({
      issuedAt: row.issued_at,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      validityDays: row.validity_days,
    });
    const remindDays = Math.max(1, Math.min(365, Number(row.renewal_remind_days || CERT_RENEWAL_REMIND_DAYS_DEFAULT)));
    const daysLeft = Math.ceil((validity.until_date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const dynamicStatus = trimText(row.status).toLowerCase() === 'revoked'
      ? 'revoked'
      : daysLeft < 0
        ? 'expired'
        : 'active';

    if (!row.valid_from || !row.valid_until || Number(row.validity_days || 0) <= 0 || trimText(row.status) !== dynamicStatus) {
      await run(
        `UPDATE te_certificates
         SET valid_from = ?, valid_until = ?, validity_days = ?, renewal_remind_days = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [validity.valid_from, validity.valid_until, validity.effective_days, remindDays, dynamicStatus, Number(row.id)]
      );
    }

    output.push({
      ...row,
      valid_from: validity.valid_from,
      valid_until: validity.valid_until,
      validity_days: validity.effective_days,
      renewal_remind_days: remindDays,
      status: dynamicStatus,
      days_left: daysLeft,
      should_remind: dynamicStatus !== 'revoked' && daysLeft <= remindDays,
    });
  }

  return output;
};

const ensureAutoRecertificationJobs = async ({ userId, username }) => {
  const uid = Number(userId || 0);
  if (!uid) return { created: 0 };

  const certs = await buildCertificatesWithStatus({ userId: uid });
  let created = 0;
  const now = new Date();

  for (const cert of certs) {
    if (!cert.should_remind || !Number(cert.paper_id || 0)) continue;
    const existing = await get(
      `SELECT id
       FROM te_recertification_jobs
       WHERE certificate_id = ? AND status IN ('scheduled', 'in_progress')
       ORDER BY id DESC
       LIMIT 1`,
      [Number(cert.id)]
    );
    if (existing) continue;

    const dueDate = parseDate(cert.valid_until) || now;
    const dueAt = toMysqlDatetime(dueDate.getTime() < now.getTime() ? now : dueDate);

    await run(
      `INSERT INTO te_recertification_jobs
        (certificate_id, result_id, paper_id, user_id, username, due_at, status, trigger_type, note)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'auto', ?)`,
      [
        Number(cert.id),
        Number(cert.result_id || 0),
        Number(cert.paper_id || 0),
        uid,
        trimText(username || cert.username || ''),
        dueAt,
        cert.status === 'expired' ? '证书已过期，自动安排复考' : '证书即将到期，自动安排复考',
      ]
    );
    created += 1;
  }

  return { created };
};

const markRecertificationCompleted = async ({ userId, paperId, resultId, passed }) => {
  const uid = Number(userId || 0);
  const pid = Number(paperId || 0);
  const rid = Number(resultId || 0);
  if (!uid || !pid || !rid) return;

  const isPassed = Number(passed);
  if (Number.isFinite(isPassed) && isPassed !== 1) return;
  if (!Number.isFinite(isPassed)) {
    const row = await get('SELECT passed FROM te_exam_results WHERE id = ? LIMIT 1', [rid]);
    if (Number(row?.passed || 0) !== 1) return;
  }

  const job = await get(
    `SELECT *
     FROM te_recertification_jobs
     WHERE user_id = ? AND paper_id = ? AND status IN ('scheduled', 'in_progress')
     ORDER BY due_at ASC, id ASC
     LIMIT 1`,
    [uid, pid]
  );
  if (!job) return;

  await run(
    `UPDATE te_recertification_jobs
     SET status = 'completed', completed_result_id = ?, updated_at = NOW()
     WHERE id = ?`,
    [rid, Number(job.id)]
  );
};

const normalizeAdviceAnswer = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => trimText(item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    const answerValues = Array.isArray(value.answer_values) ? value.answer_values : [];
    if (answerValues.length) return answerValues.map((item) => trimText(item)).filter(Boolean).join(', ');
    if (trimText(value.answer_text)) return trimText(value.answer_text);
    return trimText(JSON.stringify(value));
  }
  return trimText(value);
};

const truncateAdviceText = (value, maxLen = 120) => {
  const text = trimText(value);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
};

const buildExamAdviceFallback = ({ resultRow, paperName, weakTypes = [], wrongItems = [] }) => {
  const score = Number(resultRow?.score || 0).toFixed(2);
  const totalScore = Number(resultRow?.total_score || 0).toFixed(2);
  const passed = Number(resultRow?.passed || 0) === 1;
  const weakTypeText = weakTypes.length
    ? weakTypes.map((item) => `${toQuestionTypeCn(item.type)}(${item.count})`).join('、')
    : '暂无明显薄弱题型';
  const overview = passed
    ? `本次考试已通过（${score}/${totalScore}），建议继续巩固，避免知识点遗忘。`
    : `本次考试未通过（${score}/${totalScore}），建议先补齐薄弱知识点后再复考。`;

  const steps = [
    `1. 优先复训题型：${weakTypeText}。`,
    `2. 回看课程《${paperName || '当前试卷'}》对应文档/视频，并整理错题原因。`,
    '3. 按“概念复习 -> 题目重做 -> 总结归纳”节奏完成一轮训练。',
    '4. 在7天内安排一次模拟测试，重点验证本次错题是否完全掌握。',
  ];

  if (wrongItems.length) {
    const topMistakes = wrongItems
      .slice(0, 3)
      .map((item, idx) => `${idx + 1}) ${truncateAdviceText(item.stem, 80)}`)
      .join('；');
    steps.push(`5. 本次优先错题：${topMistakes}`);
  }

  return `${overview}\n${steps.join('\n')}`;
};

const extractAdviceTextFromAi = (content) => {
  const parsed = extractJsonCandidate(content);
  if (parsed) {
    if (typeof parsed === 'string') return trimText(parsed);
    if (Array.isArray(parsed)) {
      const lines = parsed.map((item) => trimText(typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean);
      if (lines.length) return lines.join('\n');
    }
    if (parsed && typeof parsed === 'object') {
      if (trimText(parsed.advice_text)) return trimText(parsed.advice_text);
      const lines = [];
      if (trimText(parsed.summary)) lines.push(`总体评价：${trimText(parsed.summary)}`);
      if (Array.isArray(parsed.suggestions) && parsed.suggestions.length) {
        lines.push('改进建议：');
        parsed.suggestions
          .map((item, idx) => `- ${idx + 1}. ${trimText(typeof item === 'string' ? item : JSON.stringify(item))}`)
          .forEach((line) => lines.push(line));
      }
      if (Array.isArray(parsed.plan) && parsed.plan.length) {
        lines.push('7天计划：');
        parsed.plan
          .map((item, idx) => `- Day${idx + 1}: ${trimText(typeof item === 'string' ? item : JSON.stringify(item))}`)
          .forEach((line) => lines.push(line));
      }
      if (lines.length) return lines.join('\n');
    }
  }
  return trimText(content);
};

const generateResultAdvice = async ({ req, resultId, force = false }) => {
  const rid = Number(resultId || 0);
  if (!rid) throw appError('成绩ID无效', 400);

  const resultRow = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [rid]);
  ensureResultAccess(req, resultRow, { allowAuditRead: true });

  const existing = await get('SELECT * FROM te_result_ai_advices WHERE result_id = ? LIMIT 1', [rid]);
  if (existing && !force) return existing;

  const paper = await get('SELECT id, name, pass_score FROM te_papers WHERE id = ? LIMIT 1', [Number(resultRow.paper_id || 0)]);
  const detail = parseMaybeJson(resultRow.detail_json, {});
  const detailItems = Array.isArray(detail?.details) ? detail.details : [];
  const wrongItems = detailItems.filter((item) => !item?.is_correct);

  const weakTypeCounter = new Map();
  for (const item of wrongItems) {
    const key = normalizeQuestionType(item?.question_type, 'single_choice');
    weakTypeCounter.set(key, Number(weakTypeCounter.get(key) || 0) + 1);
  }
  const weakTypes = Array.from(weakTypeCounter.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const wrongSamples = wrongItems.slice(0, 8).map((item, idx) => {
    const userAnswer = normalizeAdviceAnswer(item?.user_answer);
    const standardAnswer = normalizeAdviceAnswer(item?.standard_answer);
    return `${idx + 1}. [${toQuestionTypeCn(item?.question_type)}] ${truncateAdviceText(item?.stem, 120)}\n` +
      `   - 你的答案: ${userAnswer || '-'}\n` +
      `   - 标准答案: ${standardAnswer || '-'}`;
  });

  const inputText = [
    `学员：${trimText(resultRow.username) || `user-${resultRow.user_id}`}`,
    `试卷：${trimText(paper?.name) || `paper-${resultRow.paper_id}`}`,
    `成绩：${Number(resultRow.score || 0).toFixed(2)} / ${Number(resultRow.total_score || 0).toFixed(2)}`,
    `及格线：${Number(paper?.pass_score || detail?.pass_score || 80).toFixed(2)}`,
    `是否通过：${Number(resultRow.passed || 0) === 1 ? '通过' : '未通过'}`,
    `第几次考试：${Number(resultRow.attempt_no || 1)}`,
    `错题总数：${wrongItems.length}`,
    `薄弱题型：${weakTypes.length ? weakTypes.map((item) => `${toQuestionTypeCn(item.type)}(${item.count})`).join('、') : '无明显薄弱题型'}`,
    '错题样例：',
    wrongSamples.length ? wrongSamples.join('\n') : '无',
  ].join('\n');

  const fallbackText = buildExamAdviceFallback({
    resultRow,
    paperName: trimText(paper?.name),
    weakTypes,
    wrongItems,
  });

  let status = 'fallback';
  let adviceText = fallbackText;
  let adviceJson = null;
  let errorMessage = null;
  let modelId = null;
  let modelName = 'rule_fallback';

  try {
    const runtime = await resolveAiRuntime('EXAM_ADVICE');
    const aiResult = await callOpenAiCompatible({ runtime, inputText });
    const adviceFromAi = extractAdviceTextFromAi(aiResult.content);
    if (!adviceFromAi) throw appError('AI建议内容为空', 400);

    status = 'success';
    adviceText = adviceFromAi;
    const parsed = extractJsonCandidate(aiResult.content);
    adviceJson = parsed ? JSON.stringify(parsed) : null;
    modelId = Number(runtime.model?.id || 0) || null;
    modelName = trimText(runtime.model?.name || runtime.modelName || runtime.model?.model_name) || 'AI';

    await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error_message, operator_id, operator_name, request_ip)
       VALUES ('EXAM_ADVICE', ?, ?, 'SUCCESS', ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        modelId,
        modelName,
        Number(aiResult.latencyMs || 0),
        Number(aiResult.usage?.prompt_tokens || 0),
        Number(aiResult.usage?.completion_tokens || 0),
        Number(aiResult.usage?.total_tokens || 0),
        Number(req.user?.id || 0) || null,
        trimText(req.user?.username) || null,
        trimText(getClientIp(req)),
      ]
    );
  } catch (err) {
    errorMessage = trimText(err?.message || 'AI建议生成失败').slice(0, 2000);
    await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, error_message, operator_id, operator_name, request_ip)
       VALUES ('EXAM_ADVICE', NULL, ?, 'FAILED', 0, ?, ?, ?, ?)`,
      [
        'default',
        errorMessage,
        Number(req.user?.id || 0) || null,
        trimText(req.user?.username) || null,
        trimText(getClientIp(req)),
      ]
    );
  }

  const sourceDetail = {
    paper_name: trimText(paper?.name),
    score: Number(resultRow.score || 0),
    total_score: Number(resultRow.total_score || 0),
    pass_score: Number(paper?.pass_score || detail?.pass_score || 80),
    passed: Number(resultRow.passed || 0),
    wrong_count: wrongItems.length,
    weak_types: weakTypes,
    wrong_samples: wrongSamples,
  };

  await run(
    `INSERT INTO te_result_ai_advices
      (result_id, session_id, paper_id, user_id, username, model_id, model_name, status, advice_text, advice_json, source_detail_json, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      model_id = VALUES(model_id),
      model_name = VALUES(model_name),
      status = VALUES(status),
      advice_text = VALUES(advice_text),
      advice_json = VALUES(advice_json),
      source_detail_json = VALUES(source_detail_json),
      error_message = VALUES(error_message),
      updated_at = NOW()`,
    [
      rid,
      Number(resultRow.session_id || 0) || null,
      Number(resultRow.paper_id || 0) || null,
      Number(resultRow.user_id || 0),
      trimText(resultRow.username) || `user-${resultRow.user_id}`,
      modelId,
      modelName,
      status,
      adviceText,
      adviceJson,
      JSON.stringify(sourceDetail),
      errorMessage,
    ]
  );

  const after = await get('SELECT * FROM te_result_ai_advices WHERE result_id = ? LIMIT 1', [rid]);
  await logOperation({
    req,
    action: 'RESULT_AI_ADVICE_GENERATE',
    entity: 'result_ai_advice',
    entityId: Number(after?.id || 0) || null,
    message: `生成考试建议 result=${rid}`,
    afterData: {
      result_id: rid,
      status: trimText(after?.status),
      model_name: trimText(after?.model_name),
      error_message: trimText(after?.error_message),
    },
  });

  return after;
};

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'train-exam',
    timestamp: Date.now(),
  });
});

app.get('/api/train-exam/resources/:id/doc-preview-file', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const tokenPayload = verifyDocPreviewFileToken(req.query.token);
  if (Number(tokenPayload?.resource_id || 0) !== id) throw appError('预览令牌与资源不匹配', 401);
  if (!isDocPreviewHostAllowed({
    requestHost: trimText(req.headers.host).toLowerCase(),
    tokenHost: tokenPayload?.allowed_host,
    forwardedHost: req.headers['x-forwarded-host'],
    forwardedFor: req.headers['x-forwarded-for'],
    realIp: req.headers['x-real-ip'],
    forwarded: req.headers.forwarded,
    forwardedProto: req.headers['x-forwarded-proto'],
    forwardedPort: req.headers['x-forwarded-port'],
  })) {
    throw appError('预览令牌绑定的访问主机不匹配', 401);
  }
  if (!isPrivateRequestIp(req)) {
    throw appError('文档预览文件仅允许内网预览服务访问', 403);
  }

  const resource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  if (!resource) throw appError('资源不存在', 404);
  if (normalizeResourceType(resource.resource_type) !== 'doc') throw appError('当前资源不是文档资源', 400);
  if (normalizeSourceMode(resource.source_mode) !== 'upload') throw appError('仅上传文档支持在线预览', 400);

  const filePath = trimText(resource.storage_path);
  if (!filePath) throw appError('文档文件不存在', 404);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw appError('文档文件不存在', 404);

  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_DOC_EXTS.has(ext)) throw appError('当前文档类型不支持在线预览', 400);

  const contentType = resolveDocMimeType({ mimeType: resource.mime_type, filePath });
  const filename = path.basename(filePath) || `resource-${id}${ext || ''}`;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.sendFile(path.resolve(filePath));
}));

app.use('/api', authRequired);
app.use('/api', requireBasicViewerScope);

app.get('/api/train-exam/csrf', requireReader, asyncHandler(async (_req, res) => {
  res.json({
    token: issueCsrfToken(res),
  });
}));

const buildTrainExamMePayload = async (req) => {
  const org = await resolveUserOrgProfile({ userId: req.user.id, username: req.user.username });
  return {
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    department: org.department,
    position_title: org.position_title,
    apps: req.authApps,
    permissions: {
      train_exam_read: canReadTrainExam(req),
      train_exam_content_write: canWriteContent(req),
      train_exam_question_review: canReviewQuestions(req),
      train_exam_paper_publish: canPublishPaper(req),
      train_exam_audit_read: canReadAudit(req),
    },
  };
};

app.get('/api/auth/me', requireReader, asyncHandler(async (req, res) => {
  res.json(await buildTrainExamMePayload(req));
}));

app.get('/api/train-exam/auth/me', requireReader, asyncHandler(async (req, res) => {
  res.json(await buildTrainExamMePayload(req));
}));

app.get('/api/train-exam/settings', requireReader, asyncHandler(async (_req, res) => {
  const docPreviewMinSeconds = await getDocPreviewMinSeconds();
  res.json({
    doc_preview_min_seconds: docPreviewMinSeconds,
    doc_preview_min_seconds_min: DOC_PREVIEW_MIN_SECONDS_MIN,
    doc_preview_min_seconds_max: DOC_PREVIEW_MIN_SECONDS_MAX,
  });
}));

app.get('/api/train-exam/settings/oss', requireAdminOnly, asyncHandler(async (_req, res) => {
  const config = resolveManagedOssConfig({
    envConfig: readOssConfigFromEnv(),
    settings: await getSystemSettingValues(Object.values(OSS_SYSTEM_SETTING_KEYS)),
  });
  res.json(buildManagedOssSettingsResponse(config));
}));

app.put('/api/train-exam/settings/oss', requireAdminOnly, asyncHandler(async (req, res) => {
  const settingKeys = Object.values(OSS_SYSTEM_SETTING_KEYS);
  const currentSettings = await getSystemSettingValues(settingKeys);
  const before = resolveManagedOssConfig({
    envConfig: readOssConfigFromEnv(),
    settings: currentSettings,
  });
  const nextInput = normalizeManagedOssSettingsInput({
    payload: req.body || {},
    currentSettings,
  });
  const nextSettings = serializeManagedOssSettings(nextInput);
  const effectiveNext = resolveManagedOssConfig({
    envConfig: readOssConfigFromEnv(),
    settings: nextSettings,
  });
  if (effectiveNext.enabled) validateOssConfig(effectiveNext);

  for (const [settingKey, settingValue] of Object.entries(nextSettings)) {
    await upsertSystemSettingValue({
      settingKey,
      settingValue,
      user: req.user,
    });
  }

  const afterSettings = await getSystemSettingValues(settingKeys);
  const after = resolveManagedOssConfig({
    envConfig: readOssConfigFromEnv(),
    settings: afterSettings,
  });

  await logOperation({
    req,
    action: 'SETTINGS_UPDATE',
    entity: 'system_settings',
    entityId: null,
    message: '更新阿里云 OSS 配置',
    beforeData: summarizeManagedOssConfig(before),
    afterData: summarizeManagedOssConfig(after),
  });

  res.json(buildManagedOssSettingsResponse(after));
}));

app.put('/api/train-exam/settings/doc-preview-threshold', requireAdminOnly, asyncHandler(async (req, res) => {
  const minReadSeconds = normalizeDocPreviewMinSeconds(req.body?.min_read_seconds, NaN);
  if (!Number.isFinite(minReadSeconds)) {
    throw appError(`文档学习阈值必须是 ${DOC_PREVIEW_MIN_SECONDS_MIN}-${DOC_PREVIEW_MIN_SECONDS_MAX} 的整数秒`, 400);
  }

  const before = await getDocPreviewMinSeconds();
  await upsertSystemSettingValue({
    settingKey: 'doc_preview_min_seconds',
    settingValue: String(minReadSeconds),
    user: req.user,
  });
  const after = await getDocPreviewMinSeconds();

  await logOperation({
    req,
    action: 'SETTINGS_UPDATE',
    entity: 'system_settings',
    entityId: null,
    message: '更新文档学习阈值',
    beforeData: { doc_preview_min_seconds: before },
    afterData: { doc_preview_min_seconds: after },
  });

  res.json({
    doc_preview_min_seconds: after,
    doc_preview_min_seconds_min: DOC_PREVIEW_MIN_SECONDS_MIN,
    doc_preview_min_seconds_max: DOC_PREVIEW_MIN_SECONDS_MAX,
  });
}));

app.get('/api/train-exam/user-profiles', requireAuditorReader, asyncHandler(async (req, res) => {
  const keyword = trimText(req.query.keyword);
  const limit = toBoundedLimit(req.query.limit, 200);
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(username LIKE ? OR department LIKE ? OR position_title LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT *
     FROM te_user_profiles
     ${whereSql}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );
  res.json(rows);
}));

app.put('/api/train-exam/user-profiles/:userId', requireContentWriter, asyncHandler(async (req, res) => {
  const userId = Number(req.params.userId);
  const username = trimText(req.body?.username);
  const department = trimText(req.body?.department);
  const positionTitle = trimText(req.body?.position_title);

  if (!userId || !username) throw appError('userId 和 username 必填', 400);
  const after = await upsertUserProfile({
    userId,
    username,
    department,
    positionTitle,
    operator: req.user,
  });

  await logOperation({
    req,
    action: 'USER_PROFILE_UPSERT',
    entity: 'user_profile',
    entityId: Number(after?.id || 0) || null,
    message: `更新用户画像 ${username}`,
    afterData: after,
  });

  res.json(after);
}));

app.get('/api/train-exam/courses', requireReader, asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 20);
  const keyword = trimText(req.query.keyword);

  const where = [];
  const params = [];
  const accessFilter = buildCourseWhereForReader(req);
  if (accessFilter.whereSql) {
    where.push(accessFilter.whereSql.replace(/^WHERE\s+/i, ''));
    params.push(...accessFilter.params);
  }
  if (keyword) {
    where.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await get(`SELECT COUNT(1) AS total FROM te_courses ${whereSql}`, params);
  const total = Number(totalRow?.total || 0);
  const offset = (page - 1) * limit;

  const rows = await query(
    `SELECT * FROM te_courses ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: rows,
    total,
    page,
    limit,
  });
}));

app.post('/api/train-exam/courses', requireContentWriter, asyncHandler(async (req, res) => {
  const title = trimText(req.body?.title);
  if (!title) throw appError('课程标题不能为空', 400);

  const description = trimText(req.body?.description);
  const status = normalizeCourseStatus(req.body?.status, 'draft');
  const duration = Math.max(10, Math.min(600, Number(req.body?.duration_minutes || 60)));

  const result = await run(
    `INSERT INTO te_courses
      (title, description, status, duration_minutes, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description || null, status, duration, Number(req.user.id) || null, req.user.username, Number(req.user.id) || null, req.user.username]
  );

  const id = Number(result.insertId || 0);
  const created = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'COURSE_CREATE',
    entity: 'course',
    entityId: id,
    message: `创建课程 ${title}`,
    afterData: created,
  });

  res.status(201).json(created);
}));

app.post('/api/train-exam/courses/bulk-delete', requireContentWriter, asyncHandler(async (req, res) => {
  const ids = parseIdArray(req.body?.course_ids || req.body?.ids);
  if (!ids.length) throw appError('请先选择要删除的课程', 400);
  const force = normalizeBoolean(req.body?.force, true);

  const deletedIds = [];
  const failed = [];

  for (const id of ids) {
    try {
      const result = await deleteCourseCascade({ courseId: id, force });
      deletedIds.push(id);
      await logOperation({
        req,
        action: 'COURSE_DELETE',
        entity: 'course',
        entityId: id,
        message: `批量删除课程 ${result.before.title}`,
        beforeData: result.before,
        afterData: {
          removed_resources: result.removedResources,
          removed_files: result.removedFiles,
          force,
        },
      });
    } catch (err) {
      failed.push({
        course_id: id,
        error: trimText(err?.message || '删除失败') || '删除失败',
      });
    }
  }

  res.json({
    success: true,
    force,
    success_count: deletedIds.length,
    failed_count: failed.length,
    deleted_ids: deletedIds,
    failed,
  });
}));

app.get('/api/train-exam/courses/:id', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [id]);
  ensureCourseReadAccess(req, row);
  res.json(row);
}));

const getInstructorReviewFormWithSummary = async (form) => {
  const responses = await query(
    'SELECT * FROM te_instructor_review_responses WHERE form_id = ? ORDER BY updated_at DESC, id DESC',
    [Number(form.id || 0)]
  );
  return {
    ...form,
    summary: buildInstructorReviewQuestionnaireSummary(responses),
  };
};

const activateDueScheduledInstructorReviews = async () => {
  await run(
    `UPDATE te_instructor_review_forms
     SET status = 'published',
         scheduled_publish_at = NULL,
         updated_at = NOW()
     WHERE status = 'scheduled'
       AND scheduled_publish_at IS NOT NULL
       AND scheduled_publish_at <= UTC_TIMESTAMP()`
  );
};

app.get('/api/train-exam/my/instructor-review-forms', requireReader, asyncHandler(async (req, res) => {
  await activateDueScheduledInstructorReviews();
  const userId = Number(req.user.id || 0);
  const rows = await query(
    `SELECT
      f.*,
      r.id AS response_id,
      r.clarity_score,
      r.interaction_score,
      r.practical_score,
      r.time_control_score,
      r.qa_score,
      r.final_score,
      r.rating_label,
      r.feedback,
      r.anonymous,
      r.created_at AS response_created_at,
      r.updated_at AS response_updated_at
     FROM te_instructor_review_forms f
     LEFT JOIN te_instructor_review_responses r
      ON r.form_id = f.id AND r.user_id = ?
     WHERE f.status = 'published'
     ORDER BY f.updated_at DESC, f.id DESC`,
    [userId]
  );
  res.json({
    items: rows.map((row) => ({
      ...row,
      submitted: Number(row.response_id || 0) > 0,
    })),
  });
}));

const saveInstructorReviewResponse = async (req, res) => {
  await activateDueScheduledInstructorReviews();
  const formId = Number(req.params.id || 0);
  const form = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [formId]);
  if (!form) throw appError('讲师评价问卷不存在', 404);
  if (trimText(form.status) !== 'published') throw appError('问卷未发布或已关闭，暂不能评价', 403);

  const userId = Number(req.user.id || 0);
  const input = normalizeInstructorReviewResponseInput(req.body || {});
  await run(
    `INSERT INTO te_instructor_review_responses
      (form_id, user_id, username, clarity_score, interaction_score, practical_score, time_control_score, qa_score, final_score, rating_label, feedback, anonymous)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      clarity_score = VALUES(clarity_score),
      interaction_score = VALUES(interaction_score),
      practical_score = VALUES(practical_score),
      time_control_score = VALUES(time_control_score),
      qa_score = VALUES(qa_score),
      final_score = VALUES(final_score),
      rating_label = VALUES(rating_label),
      feedback = VALUES(feedback),
      anonymous = VALUES(anonymous),
      updated_at = NOW()`,
    [
      formId,
      userId,
      trimText(req.user.username),
      input.clarity_score,
      input.interaction_score,
      input.practical_score,
      input.time_control_score,
      input.qa_score,
      input.final_score,
      input.rating_label,
      input.feedback || null,
      input.anonymous,
    ]
  );
  const response = await get(
    'SELECT * FROM te_instructor_review_responses WHERE form_id = ? AND user_id = ? LIMIT 1',
    [formId, userId]
  );
  res.status(201).json(response);
};

app.post('/api/train-exam/instructor-review-forms/:id/response', requireReader, asyncHandler(saveInstructorReviewResponse));

app.put('/api/train-exam/instructor-review-forms/:id/response', requireReader, asyncHandler(saveInstructorReviewResponse));

app.get('/api/train-exam/admin/instructor-review-forms', requireAdminOnly, asyncHandler(async (_req, res) => {
  await activateDueScheduledInstructorReviews();
  const forms = await query(
    `SELECT *
     FROM te_instructor_review_forms
     ORDER BY updated_at DESC, id DESC`
  );
  const items = [];
  for (const form of forms) {
    items.push(await getInstructorReviewFormWithSummary(form));
  }
  res.json({ items });
}));

app.post('/api/train-exam/admin/instructor-review-forms', requireAdminOnly, asyncHandler(async (req, res) => {
  const input = normalizeInstructorQuestionnaireInput(req.body || {});
  if (!input.title) throw appError('问卷标题不能为空', 400);
  if (!input.instructor_name) throw appError('讲师姓名不能为空', 400);
  const result = await run(
    `INSERT INTO te_instructor_review_forms
      (title, instructor_name, description, status, scheduled_publish_at, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [input.title, input.instructor_name, input.description || null, input.status, Number(req.user.id) || null, req.user.username, Number(req.user.id) || null, req.user.username]
  );
  const form = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [Number(result.insertId || 0)]);
  res.status(201).json(await getInstructorReviewFormWithSummary(form));
}));

app.put('/api/train-exam/admin/instructor-review-forms/:id', requireAdminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id || 0);
  const before = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('讲师评价问卷不存在', 404);
  const input = normalizeInstructorQuestionnaireInput({
    title: req.body?.title !== undefined ? req.body.title : before.title,
    instructor_name: req.body?.instructor_name !== undefined ? req.body.instructor_name : before.instructor_name,
    description: req.body?.description !== undefined ? req.body.description : before.description,
    status: req.body?.status !== undefined ? req.body.status : before.status,
  });
  if (!input.title) throw appError('问卷标题不能为空', 400);
  if (!input.instructor_name) throw appError('讲师姓名不能为空', 400);
  await run(
    `UPDATE te_instructor_review_forms
     SET title = ?,
         instructor_name = ?,
         description = ?,
         status = ?,
         scheduled_publish_at = CASE WHEN ? = 'scheduled' THEN scheduled_publish_at ELSE NULL END,
         updated_by_id = ?,
         updated_by_name = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [input.title, input.instructor_name, input.description || null, input.status, input.status, Number(req.user.id) || null, req.user.username, id]
  );
  const after = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [id]);
  res.json(await getInstructorReviewFormWithSummary(after));
}));

app.post('/api/train-exam/admin/instructor-review-forms/:id/schedule-publish', requireAdminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id || 0);
  const before = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('讲师评价问卷不存在', 404);
  if (trimText(before.status) === 'published') throw appError('问卷已发布，不能设置定时发布', 409);
  if (trimText(before.status) === 'closed') throw appError('已关闭问卷不能设置定时发布', 409);

  const scheduledPublishAt = normalizeScheduledPublishAt(req.body?.scheduled_publish_at);
  await run(
    `UPDATE te_instructor_review_forms
     SET status = 'scheduled',
         scheduled_publish_at = ?,
         updated_by_id = ?,
         updated_by_name = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [scheduledPublishAt, Number(req.user.id) || null, req.user.username, id]
  );

  const after = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [id]);
  await logOperation({
    req,
    action: 'INSTRUCTOR_REVIEW_SCHEDULE_PUBLISH',
    entity: 'instructor_review_form',
    entityId: id,
    message: `定时发布讲师评价问卷 ${id}`,
    beforeData: { status: before.status, scheduled_publish_at: before.scheduled_publish_at || null },
    afterData: { status: after.status, scheduled_publish_at: after.scheduled_publish_at || null },
  });

  res.json(await getInstructorReviewFormWithSummary(after));
}));

app.get('/api/train-exam/admin/instructor-review-forms/:id/responses', requireAdminOnly, asyncHandler(async (req, res) => {
  await activateDueScheduledInstructorReviews();
  const id = Number(req.params.id || 0);
  const form = await get('SELECT * FROM te_instructor_review_forms WHERE id = ? LIMIT 1', [id]);
  if (!form) throw appError('讲师评价问卷不存在', 404);
  const rows = await query(
    `SELECT *
     FROM te_instructor_review_responses
     WHERE form_id = ?
     ORDER BY updated_at DESC, id DESC`,
    [id]
  );
  res.json({
    form: await getInstructorReviewFormWithSummary(form),
    items: rows,
    summary: buildInstructorReviewQuestionnaireSummary(rows),
  });
}));

app.put('/api/train-exam/courses/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('课程不存在', 404);

  const title = trimText(req.body?.title || before.title);
  if (!title) throw appError('课程标题不能为空', 400);
  const description = req.body?.description !== undefined ? trimText(req.body.description) : before.description;
  const status = req.body?.status ? normalizeCourseStatus(req.body.status, before.status) : before.status;
  const duration = req.body?.duration_minutes !== undefined
    ? Math.max(10, Math.min(600, Number(req.body.duration_minutes || 60)))
    : Number(before.duration_minutes || 60);

  await run(
    `UPDATE te_courses
     SET title = ?, description = ?, status = ?, duration_minutes = ?,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [title, description || null, status, duration, Number(req.user.id) || null, req.user.username, id]
  );

  const after = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'COURSE_UPDATE',
    entity: 'course',
    entityId: id,
    message: `更新课程 ${title}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

app.delete('/api/train-exam/courses/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const force = normalizeBoolean(req.query?.force, false);
  const result = await deleteCourseCascade({ courseId: id, force });

  await logOperation({
    req,
    action: 'COURSE_DELETE',
    entity: 'course',
    entityId: id,
    message: `删除课程 ${result.before.title}`,
    beforeData: result.before,
    afterData: {
      removed_resources: result.removedResources,
      removed_files: result.removedFiles,
      force,
    },
  });

  res.json({
    success: true,
    force,
    removed_resources: result.removedResources,
    removed_files: result.removedFiles,
  });
}));

app.get('/api/train-exam/courses/:id/resources', requireReader, asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  const course = await get('SELECT * FROM te_courses WHERE id = ? LIMIT 1', [courseId]);
  ensureCourseReadAccess(req, course);

  const rows = await query(
    `SELECT * FROM te_course_resources WHERE course_id = ? ORDER BY sort_order ASC, id ASC`,
    [courseId]
  );
  res.json(rows);
}));

app.post('/api/train-exam/courses/:id/resources', requireContentWriter, asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  const course = await get('SELECT id, title FROM te_courses WHERE id = ? LIMIT 1', [courseId]);
  if (!course) throw appError('课程不存在', 404);

  const name = trimText(req.body?.name);
  const resourceType = normalizeResourceType(req.body?.resource_type);
  const sourceMode = normalizeSourceMode(req.body?.source_mode);
  const storageBackend = resolveStorageBackend({
    sourceMode,
    requested: req.body?.storage_backend,
    fallback: sourceMode === 'external' ? 'external' : 'local',
  });
  const sourceUrl = trimText(req.body?.source_url);
  const forceWatch = normalizeBoolean(req.body?.force_watch, false) ? 1 : 0;
  const sortOrder = Math.max(0, Math.min(9999, Number(req.body?.sort_order || 0)));

  if (!name) throw appError('资源名称不能为空', 400);
  if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) throw appError('资源类型仅支持：文档/视频/外链', 400);
  if (!ALLOWED_SOURCE_MODES.has(sourceMode)) throw appError('来源模式仅支持：上传/外链', 400);
  if (!ALLOWED_STORAGE_BACKENDS.has(storageBackend)) throw appError('存储后端仅支持：本地/OSS/外链', 400);
  if (sourceMode === 'external' && !sourceUrl) throw appError('外链资源必须提供 source_url', 400);
  if (storageBackend === 'oss' && resourceType !== 'video') throw appError('当前仅视频资源支持 OSS 受管存储', 400);
  if (resourceType !== 'video' && forceWatch) throw appError('仅视频资源可启用强制播放', 400);
  if (forceWatch && !supportsManagedVideoPlayback({ resourceType, sourceMode, storageBackend })) {
    throw appError('强制播放仅支持受管上传视频资源', 400);
  }

  const uploadStatus = sourceMode === 'external' ? 'ready' : 'pending';

  const result = await run(
    `INSERT INTO te_course_resources
      (course_id, name, resource_type, source_mode, storage_backend, force_watch, sort_order, object_key, object_etag, upload_status, source_url, created_by_id, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      courseId,
      name,
      resourceType,
      sourceMode,
      storageBackend,
      forceWatch,
      sortOrder,
      null,
      null,
      uploadStatus,
      sourceMode === 'external' ? sourceUrl || null : null,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );

  const id = Number(result.insertId || 0);
  const created = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'RESOURCE_CREATE',
    entity: 'course_resource',
    entityId: id,
    message: `创建资源 ${name}`,
    afterData: created,
  });

  res.status(201).json(created);
}));

app.put('/api/train-exam/resources/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('资源不存在', 404);

  const name = req.body?.name !== undefined ? trimText(req.body.name) : trimText(before.name);
  const resourceType = req.body?.resource_type !== undefined
    ? normalizeResourceType(req.body.resource_type)
    : normalizeResourceType(before.resource_type);
  const sourceMode = req.body?.source_mode !== undefined
    ? normalizeSourceMode(req.body.source_mode)
    : normalizeSourceMode(before.source_mode);
  const beforeSourceMode = normalizeSourceMode(before.source_mode);
  const beforeStorageBackend = resolveStorageBackend({
    sourceMode: beforeSourceMode,
    requested: before.storage_backend,
    fallback: beforeSourceMode === 'external' ? 'external' : 'local',
  });
  const storageBackend = req.body?.storage_backend !== undefined
    ? resolveStorageBackend({
      sourceMode,
      requested: req.body.storage_backend,
      fallback: beforeStorageBackend,
    })
    : beforeSourceMode === sourceMode
      ? beforeStorageBackend
      : resolveStorageBackend({
        sourceMode,
        fallback: sourceMode === 'external' ? 'external' : 'local',
      });
  const sourceUrlInput = req.body?.source_url !== undefined ? trimText(req.body.source_url) : trimText(before.source_url);
  const nextSortOrderRaw = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : Number(before.sort_order || 0);
  const sortOrder = Number.isFinite(nextSortOrderRaw)
    ? Math.max(0, Math.min(9999, Math.floor(nextSortOrderRaw)))
    : Math.max(0, Math.min(9999, Number(before.sort_order || 0)));
  let forceWatch = req.body?.force_watch !== undefined
    ? (normalizeBoolean(req.body.force_watch, Number(before.force_watch || 0) === 1) ? 1 : 0)
    : (Number(before.force_watch || 0) === 1 ? 1 : 0);

  if (!name) throw appError('资源名称不能为空', 400);
  if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) throw appError('资源类型仅支持：文档/视频/外链', 400);
  if (!ALLOWED_SOURCE_MODES.has(sourceMode)) throw appError('来源模式仅支持：上传/外链', 400);
  if (!ALLOWED_STORAGE_BACKENDS.has(storageBackend)) throw appError('存储后端仅支持：本地/OSS/外链', 400);
  if (sourceMode === 'external' && !sourceUrlInput) throw appError('外链资源必须提供 source_url', 400);
  if (storageBackend === 'oss' && resourceType !== 'video') throw appError('当前仅视频资源支持 OSS 受管存储', 400);
  if (resourceType !== 'video' && forceWatch) throw appError('仅视频资源可启用强制播放', 400);
  if (forceWatch && !supportsManagedVideoPlayback({ resourceType, sourceMode, storageBackend })) {
    throw appError('强制播放仅支持受管上传视频资源', 400);
  }

  let storagePath = trimText(before.storage_path) || null;
  let objectKey = trimText(before.object_key) || null;
  let objectEtag = trimText(before.object_etag) || null;
  let mimeType = trimText(before.mime_type) || null;
  let fileSize = Number(before.file_size || 0) || null;
  let uploadStatus = normalizeUploadStatus(
    before.upload_status,
    trimText(before.source_url) || trimText(before.storage_path) || trimText(before.object_key) ? 'ready' : 'pending'
  );
  let transcodeStatus = normalizeTranscodeStatus(before.transcode_status, 'none');
  let transcodeProgress = Math.max(0, Math.min(100, Number(before.transcode_progress || 100)));
  let transcodeMessage = trimText(before.transcode_message) || null;
  let transcodeJobId = Number(before.transcode_job_id || 0) || null;
  const shouldClearLocalUploadData = sourceMode === 'external' || storageBackend !== 'local';
  const shouldClearObjectData = sourceMode === 'external' || storageBackend !== 'oss';

  if (shouldClearLocalUploadData) {
    storagePath = null;
    mimeType = null;
    fileSize = null;
    transcodeStatus = 'none';
    transcodeProgress = 100;
    transcodeMessage = null;
    transcodeJobId = null;
  }

  if (shouldClearObjectData) {
    objectKey = null;
    objectEtag = null;
  }

  if (sourceMode === 'external') {
    uploadStatus = 'ready';
  } else if (storageBackend === 'oss') {
    if (beforeStorageBackend !== 'oss') {
      uploadStatus = 'pending';
    } else if (!objectKey) {
      uploadStatus = 'pending';
    }
  } else {
    uploadStatus = storagePath ? 'ready' : 'pending';
  }

  if (resourceType !== 'video' || !supportsManagedVideoPlayback({ resourceType, sourceMode, storageBackend })) {
    forceWatch = 0;
  }

  if (resourceType !== 'video' || sourceMode !== 'upload' || storageBackend !== 'local') {
    transcodeStatus = 'none';
    transcodeProgress = 100;
    transcodeMessage = resourceType === 'video' && sourceMode === 'upload' && uploadStatus !== 'ready'
      ? '请上传视频文件后再播放'
      : null;
    transcodeJobId = null;
  } else if (!storagePath) {
    transcodeStatus = 'none';
    transcodeProgress = 100;
    transcodeMessage = '请上传视频文件后再播放';
    transcodeJobId = null;
  }

  if (sourceMode !== 'upload' || resourceType !== 'video' || storageBackend !== 'local') {
    await run(
      `UPDATE te_resource_transcode_jobs
       SET status = 'skipped',
           progress_percent = 100,
           error_message = CASE
             WHEN IFNULL(error_message, '') = '' THEN '资源配置已变更，任务已取消'
             ELSE error_message
           END,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE resource_id = ? AND status IN ('queued', 'running')`,
      [id]
    );
  }

  await run(
    `UPDATE te_course_resources
     SET name = ?, resource_type = ?, source_mode = ?, storage_backend = ?, source_url = ?, force_watch = ?, sort_order = ?,
         storage_path = ?, object_key = ?, object_etag = ?, mime_type = ?, file_size = ?, upload_status = ?,
         transcode_status = ?, transcode_progress = ?, transcode_message = ?, transcode_job_id = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      name,
      resourceType,
      sourceMode,
      storageBackend,
      sourceMode === 'external' ? sourceUrlInput : null,
      forceWatch,
      sortOrder,
      storagePath,
      objectKey,
      objectEtag,
      mimeType,
      fileSize,
      uploadStatus,
      transcodeStatus,
      transcodeProgress,
      transcodeMessage,
      transcodeJobId,
      id,
    ]
  );

  if (shouldClearLocalUploadData && trimText(before.storage_path)) {
    await removeResourceFileIfExists(before.storage_path);
  }

  const after = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'RESOURCE_UPDATE',
    entity: 'course_resource',
    entityId: id,
    message: `更新资源 ${name}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

app.delete('/api/train-exam/resources/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('资源不存在', 404);

  const jobRows = await query(
    `SELECT id, source_path, target_path
     FROM te_resource_transcode_jobs
     WHERE resource_id = ?`,
    [id]
  );

  await run(
    `UPDATE te_resource_transcode_jobs
     SET status = 'skipped',
         progress_percent = 100,
         error_message = CASE
           WHEN IFNULL(error_message, '') = '' THEN '资源已删除，任务已取消'
           ELSE error_message
         END,
         finished_at = NOW(),
         updated_at = NOW()
     WHERE resource_id = ? AND status IN ('queued', 'running')`,
    [id]
  );

  await run('DELETE FROM te_resource_progress WHERE resource_id = ?', [id]);
  await run('DELETE FROM te_resource_transcode_jobs WHERE resource_id = ?', [id]);
  await run('DELETE FROM te_course_resources WHERE id = ?', [id]);

  const files = new Set();
  if (trimText(before.storage_path)) files.add(trimText(before.storage_path));
  for (const row of jobRows) {
    const sourcePath = trimText(row?.source_path);
    const targetPath = trimText(row?.target_path);
    if (sourcePath) files.add(sourcePath);
    if (targetPath) files.add(targetPath);
  }

  let removedFiles = 0;
  for (const filePath of files) {
    const removed = await removeResourceFileIfExists(filePath);
    if (removed) removedFiles += 1;
  }

  await logOperation({
    req,
    action: 'RESOURCE_DELETE',
    entity: 'course_resource',
    entityId: id,
    message: `删除资源 ${trimText(before.name) || id}`,
    beforeData: before,
    afterData: { removed_files: removedFiles },
  });

  res.json({ success: true, removed_files: removedFiles });
}));

app.put('/api/train-exam/resources/:id/playback-policy', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('资源不存在', 404);
  if (normalizeResourceType(before.resource_type) !== 'video') throw appError('仅视频资源支持播放策略设置', 400);

  const forceWatch = normalizeBoolean(req.body?.force_watch, Number(before.force_watch || 0) === 1) ? 1 : 0;
  const managedPlayback = supportsManagedVideoPlayback({
    resourceType: before.resource_type,
    sourceMode: before.source_mode,
    storageBackend: before.storage_backend,
  });
  if (forceWatch && !managedPlayback) throw appError('强制播放仅支持受管上传视频资源', 400);
  await run(
    `UPDATE te_course_resources
     SET force_watch = ?, updated_at = NOW()
     WHERE id = ?`,
    [forceWatch, id]
  );
  const after = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'RESOURCE_PLAYBACK_POLICY_UPDATE',
    entity: 'course_resource',
    entityId: id,
    message: `更新视频播放策略 ${id}`,
    beforeData: { force_watch: Number(before.force_watch || 0) },
    afterData: { force_watch: Number(after.force_watch || 0) },
  });

  res.json(after);
}));

app.post('/api/train-exam/resources/:id/upload', requireContentWriter, uploadRateLimit, uploadResource.single('file'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  if (!resource) throw appError('资源不存在', 404);
  if (normalizeSourceMode(resource.source_mode) !== 'upload') {
    const sourceMode = normalizeSourceMode(resource.source_mode);
    const sourceModeText = sourceMode === 'external' ? '外链' : sourceMode || '未知';
    throw appError(`资源ID ${id} 当前来源模式为“${sourceModeText}”，请先新建“上传”模式资源并使用其资源ID`, 400);
  }
  if (resolveStorageBackend({ sourceMode: resource.source_mode, requested: resource.storage_backend, fallback: 'local' }) !== 'local') {
    throw appError('当前资源已配置为 OSS 受管存储，请改用 OSS 直传接口', 400);
  }
  if (!req.file) throw appError('缺少上传文件', 400);
  const tempFilePath = trimText(req.file.path);
  let storedUploadedPath = '';
  let persisted = false;

  try {
    const ext = path.extname(trimText(req.file.originalname)).toLowerCase();
    const mime = trimText(req.file.mimetype).toLowerCase();
    const type = normalizeResourceType(resource.resource_type);

    if (type === 'doc') {
      const extOk = ALLOWED_DOC_EXTS.has(ext);
      const mimeOk = ALLOWED_DOC_MIME.has(mime) || !mime || mime === 'application/octet-stream';
      if (!extOk || !mimeOk) throw appError('文档资源仅支持 pdf/doc/docx/txt/md', 400);
      if (Number(req.file.size || 0) > FILE_MAX_BYTES) {
        throw appError(`文档文件过大，最大支持 ${Math.round(FILE_MAX_BYTES / (1024 * 1024))}MB`, 413);
      }
    }

    if (type === 'video') {
      const extOk = ALLOWED_VIDEO_EXTS.has(ext);
      const mimeOk = ALLOWED_VIDEO_MIME.has(mime) || !mime || mime === 'application/octet-stream';
      if (!extOk || !mimeOk) throw appError('视频资源仅支持 mp4/webm/mov/m4v', 400);
      const isValidContainer = await validateVideoContainer({
        filePath: tempFilePath,
        ext,
        fileBuffer: tempFilePath ? null : req.file.buffer,
      });
      if (!isValidContainer) {
        throw appError('视频文件格式异常或已损坏，请上传标准 mp4/webm/mov/m4v 文件', 400);
      }
    }

    if (type === 'link') {
      throw appError('外链资源不支持上传文件', 400);
    }

    const targetDir = path.join(RESOURCE_ROOT, String(resource.course_id));
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const filePath = tempFilePath
      ? await moveUploadFile(targetDir, req.file.originalname, tempFilePath)
      : await writeUploadFile(targetDir, req.file.originalname, req.file.buffer);
    storedUploadedPath = filePath;
    let finalMimeType = type === 'video'
      ? resolveVideoMimeType({ mimeType: mime, filePath: req.file.originalname })
      : (mime || null);
    let finalFileSize = Number(req.file.size || 0) || null;
    let sourceCodec = '';
    let finalCodec = '';
    let queuedTranscodeJobId = null;

    if (type === 'video') {
      sourceCodec = await detectVideoCodecTag(filePath);
      const sourceExt = path.extname(filePath).toLowerCase();
      const shouldQueueTranscode =
        VIDEO_TRANSCODE_ENABLED && (sourceCodec === 'hevc' || sourceExt !== '.mp4' || sourceCodec === 'unknown');

      await run(
        `UPDATE te_course_resources
         SET storage_backend = 'local', storage_path = ?, object_key = NULL, object_etag = NULL, upload_status = 'ready',
             source_url = NULL, mime_type = ?, file_size = ?, updated_at = NOW(),
             transcode_status = ?, transcode_progress = ?, transcode_message = ?, transcode_job_id = NULL
         WHERE id = ?`,
        [
          filePath,
          finalMimeType,
          finalFileSize,
          shouldQueueTranscode ? 'queued' : 'succeeded',
          shouldQueueTranscode ? 0 : 100,
          shouldQueueTranscode ? '文件已上传，正在后台转码，可关闭页面稍后查看结果' : '无需转码，可直接播放',
          id,
        ]
      );
      persisted = true;

      await run(
        `UPDATE te_resource_transcode_jobs
         SET status = 'skipped',
             progress_percent = 100,
             error_message = '检测到新上传文件，旧任务已取消',
             finished_at = NOW(),
             updated_at = NOW()
         WHERE resource_id = ? AND status IN ('queued', 'running')`,
        [id]
      );

      if (shouldQueueTranscode) {
        try {
          queuedTranscodeJobId = await createTranscodeJob({
            resourceId: id,
            sourcePath: filePath,
            sourceCodec,
            operator: req.user,
          });
          await markResourceTranscodeState({
            resourceId: id,
            status: 'queued',
            progressPercent: 0,
            message: '文件已上传，正在后台转码，可关闭页面稍后查看结果',
            jobId: queuedTranscodeJobId,
          });
          triggerTranscodeRunner();
        } catch (enqueueErr) {
          await markResourceTranscodeState({
            resourceId: id,
            status: 'failed',
            progressPercent: 100,
            message: `创建转码任务失败：${trimText(enqueueErr?.message || enqueueErr) || '请稍后重试'}`,
            jobId: null,
          });
          throw appError('创建后台转码任务失败，请重试', 500);
        }
      } else {
        finalMimeType = 'video/mp4';
        finalCodec = sourceCodec || 'h264';
        await markResourceTranscodeState({
          resourceId: id,
          status: 'succeeded',
          progressPercent: 100,
          message: '无需转码，可直接播放',
          jobId: null,
          mimeType: 'video/mp4',
          fileSize: finalFileSize,
        });
      }
    } else {
      await run(
        `UPDATE te_course_resources
         SET storage_backend = 'local', storage_path = ?, object_key = NULL, object_etag = NULL, upload_status = 'ready',
             source_url = NULL, mime_type = ?, file_size = ?, updated_at = NOW(),
             transcode_status = 'none', transcode_progress = 100, transcode_message = NULL, transcode_job_id = NULL
         WHERE id = ?`,
        [filePath, finalMimeType, finalFileSize, id]
      );
      persisted = true;
    }

    const after = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);

    await logOperation({
      req,
      action: 'RESOURCE_UPLOAD',
      entity: 'course_resource',
      entityId: id,
      message: `上传资源文件 ${resource.name}`,
      beforeData: { storage_path: resource.storage_path, file_size: resource.file_size },
      afterData: {
        storage_path: after.storage_path,
        file_size: after.file_size,
        transcode_enabled: type === 'video' ? VIDEO_TRANSCODE_ENABLED : false,
        source_codec: sourceCodec || null,
        final_codec: finalCodec || null,
        transcode_status: trimText(after.transcode_status),
        transcode_job_id: Number(after.transcode_job_id || 0) || null,
        queued_async: !!queuedTranscodeJobId,
      },
    });

    res.json(after);
  } catch (err) {
    if (!persisted) {
      if (storedUploadedPath) {
        await fs.promises.unlink(storedUploadedPath).catch(() => {});
      }
    }
    throw err;
  } finally {
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  }
}));

app.post('/api/train-exam/resources/:id/oss-upload-init', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  ensureManagedOssVideoResource(resource);
  const { client, config } = await getManagedOssRuntime();

  const { ext, mimeType, fileSize } = validateManagedOssUploadInput({
    fileName: req.body?.file_name || req.body?.original_name,
    mimeType: req.body?.mime_type,
    fileSize: req.body?.file_size,
    maxFileBytes: config.uploadMaxBytes,
  });
  const objectKey = buildManagedOssObjectKey({
    courseId: Number(resource.course_id || 0),
    resourceId: id,
    ext,
  });
  const signed = await createManagedOssUploadSignature({
    client,
    objectKey,
    mimeType,
    expiresSeconds: config.uploadExpiresSeconds,
  });

  await run(
    `UPDATE te_course_resources
     SET storage_backend = 'oss', storage_path = NULL, object_key = ?, object_etag = NULL, upload_status = 'uploading',
         source_url = NULL, mime_type = ?, file_size = ?, updated_at = NOW(),
         transcode_status = 'none', transcode_progress = 100, transcode_message = NULL, transcode_job_id = NULL
     WHERE id = ?`,
    [objectKey, mimeType, fileSize, id]
  );
  await run(
    `UPDATE te_resource_transcode_jobs
     SET status = 'skipped',
         progress_percent = 100,
         error_message = CASE
           WHEN IFNULL(error_message, '') = '' THEN '资源已切换为 OSS 上传，任务已取消'
           ELSE error_message
         END,
         finished_at = NOW(),
         updated_at = NOW()
     WHERE resource_id = ? AND status IN ('queued', 'running')`,
    [id]
  );

  const after = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  await logOperation({
    req,
    action: 'RESOURCE_OSS_UPLOAD_INIT',
    entity: 'course_resource',
    entityId: id,
    message: `初始化 OSS 直传 ${resource.name}`,
    beforeData: {
      object_key: resource.object_key,
      upload_status: resource.upload_status,
    },
    afterData: {
      object_key: after.object_key,
      upload_status: after.upload_status,
      file_size: after.file_size,
    },
  });

  res.json({
    ...signed,
    storage_backend: 'oss',
    allowed_mime: Array.from(ALLOWED_OSS_VIDEO_MIME),
    max_file_size: config.uploadMaxBytes,
  });
}));

app.post('/api/train-exam/resources/:id/oss-upload-complete', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  ensureManagedOssVideoResource(resource);

  const objectKey = trimText(req.body?.object_key);
  if (!objectKey) throw appError('缺少 object_key', 400);
  if (objectKey !== trimText(resource.object_key)) throw appError('OSS 对象与当前资源不匹配，请重新初始化上传', 409);

  const declaredMimeType = trimText(req.body?.mime_type).toLowerCase() || 'video/mp4';
  const declaredFileSize = Number(req.body?.file_size || 0) || null;
  const { client } = await getManagedOssRuntime();

  try {
    const headResult = await headManagedOssObject({ client, objectKey });
    const validated = validateManagedOssHeadResult({
      headResult,
      mimeType: declaredMimeType,
      fileSize: declaredFileSize,
    });
    const etag = trimText(req.body?.etag) || validated.etag || null;

    await run(
      `UPDATE te_course_resources
       SET storage_backend = 'oss', storage_path = NULL, object_key = ?, object_etag = ?, upload_status = 'ready',
           source_url = NULL, mime_type = ?, file_size = ?, updated_at = NOW(),
           transcode_status = 'none', transcode_progress = 100, transcode_message = NULL, transcode_job_id = NULL
       WHERE id = ?`,
      [objectKey, etag, validated.contentType, validated.contentLength, id]
    );
  } catch (err) {
    await run(
      `UPDATE te_course_resources
       SET upload_status = 'failed', updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
    throw err.statusCode ? err : appError(`OSS 对象校验失败：${trimText(err?.message || err) || '请重新上传'}`, 400);
  }

  const after = await get('SELECT * FROM te_course_resources WHERE id = ? LIMIT 1', [id]);
  await logOperation({
    req,
    action: 'RESOURCE_OSS_UPLOAD_COMPLETE',
    entity: 'course_resource',
    entityId: id,
    message: `完成 OSS 上传 ${resource.name}`,
    beforeData: {
      object_key: resource.object_key,
      upload_status: resource.upload_status,
    },
    afterData: {
      object_key: after.object_key,
      object_etag: after.object_etag,
      upload_status: after.upload_status,
      file_size: after.file_size,
    },
  });

  res.json(after);
}));

app.get('/api/train-exam/resources/:id/doc-preview-config', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const docPreviewMinSeconds = await getDocPreviewMinSeconds();
  const resource = ensureResourceReadAccess(req, await getResourceWithCourseById(id));
  if (normalizeResourceType(resource.resource_type) !== 'doc') throw appError('仅文档资源支持在线预览', 400);
  if (normalizeSourceMode(resource.source_mode) !== 'upload') {
    const url = trimText(resource.source_url);
    if (!url) throw appError('外链文档缺少URL，无法预览', 400);
    return res.json({
      mode: 'external',
      open_url: url,
      min_read_seconds: docPreviewMinSeconds,
      resource: {
        id: Number(resource.id || 0),
        name: trimText(resource.name),
        source_mode: normalizeSourceMode(resource.source_mode),
      },
    });
  }

  const filePath = trimText(resource.storage_path);
  if (!filePath) throw appError('文档文件不存在，请先上传文档', 404);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw appError('文档文件不存在，请重新上传', 404);

  res.json(buildDocPreviewEditorPayload({ resource, req, stat, minReadSeconds: docPreviewMinSeconds }));
}));

app.get('/api/train-exam/resources/:id/stream', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = ensureResourceReadAccess(req, await getResourceWithCourseById(id));
  const sourceMode = normalizeSourceMode(resource.source_mode);
  const storageBackend = resolveStorageBackend({
    sourceMode,
    requested: resource.storage_backend,
    fallback: sourceMode === 'external' ? 'external' : 'local',
  });

  if (sourceMode === 'external') {
    return res.json({ redirect_url: trimText(resource.source_url), mode: 'external' });
  }

  if (normalizeResourceType(resource.resource_type) === 'video' && storageBackend === 'oss') {
    const uploadStatus = normalizeUploadStatus(
      resource.upload_status,
      trimText(resource.object_key) ? 'ready' : 'pending'
    );
    if (uploadStatus !== 'ready' || !trimText(resource.object_key)) {
      throw appError('视频尚未上传完成，请完成 OSS 上传后再播放', 409);
    }
    const { client, config } = await getManagedOssRuntime();
    await headManagedOssObject({ client, objectKey: resource.object_key }).catch((err) => {
      throw err.statusCode ? err : appError('OSS 视频不存在或已失效，请重新上传', 404);
    });
    const redirectUrl = await createManagedOssPlaybackUrl({
      client,
      objectKey: resource.object_key,
      expiresSeconds: config.playbackExpiresSeconds,
    });
    return res.redirect(302, redirectUrl);
  }

  const filePath = trimText(resource.storage_path);
  if (!filePath) throw appError('资源文件不存在', 404);

  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw appError('资源文件不存在', 404);

  if (normalizeResourceType(resource.resource_type) !== 'video') {
    return res.json({
      mode: 'download',
      download_url: `/api/train-exam/resources/${id}/download`,
    });
  }

  const transcodeStatus = normalizeTranscodeStatus(resource.transcode_status, 'none');
  if (TRANSCODE_ACTIVE_STATUSES.has(transcodeStatus)) {
    throw appError('视频正在后台转码，可先关闭页面，稍后再播放', 409);
  }
  if (transcodeStatus === 'failed') {
    throw appError(trimText(resource.transcode_message) || '视频转码失败，请重新上传', 409);
  }

  const ext = path.extname(filePath).toLowerCase();
  const isValidContainer = await validateVideoContainer({ filePath, ext });
  if (!isValidContainer) {
    throw appError('视频文件格式异常或已损坏，请重新上传后再播放', 422);
  }

  const contentType = resolveVideoMimeType({ mimeType: resource.mime_type, filePath });
  const totalSize = Number(stat.size || 0);
  const range = trimText(req.headers.range);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/i);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
      return;
    }
    const hasStart = trimText(match[1]).length > 0;
    const hasEnd = trimText(match[2]).length > 0;
    let start = 0;
    let end = totalSize - 1;

    if (hasStart) {
      start = Math.max(0, Number(match[1]));
      end = hasEnd ? Math.min(totalSize - 1, Number(match[2])) : totalSize - 1;
    } else if (hasEnd) {
      // Suffix-byte-range-spec, e.g. "bytes=-16384", means last 16384 bytes.
      const suffixLength = Math.max(0, Number(match[2]));
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
        return;
      }
      start = Math.max(0, totalSize - suffixLength);
      end = totalSize - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSize) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(chunkSize));
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(totalSize));
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(filePath).pipe(res);
}));

app.get('/api/train-exam/resources/:id/playability', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = ensureResourceReadAccess(req, await getResourceWithCourseById(id));
  const sourceMode = normalizeSourceMode(resource.source_mode);
  const storageBackend = resolveStorageBackend({
    sourceMode,
    requested: resource.storage_backend,
    fallback: sourceMode === 'external' ? 'external' : 'local',
  });

  const transcodeStatus = normalizeTranscodeStatus(resource.transcode_status, 'none');
  const transcodeProgress = Math.max(0, Math.min(100, Number(resource.transcode_progress || 0)));
  const transcodeMessage = trimText(resource.transcode_message);

  if (sourceMode === 'external') {
    res.json({
      playable: true,
      reason: '',
      codec: 'external',
      mode: 'external',
      transcode_status: transcodeStatus,
      progress_percent: transcodeProgress,
    });
    return;
  }

  if (normalizeResourceType(resource.resource_type) === 'video' && storageBackend === 'oss') {
    const uploadStatus = normalizeUploadStatus(
      resource.upload_status,
      trimText(resource.object_key) ? 'ready' : 'pending'
    );
    if (uploadStatus !== 'ready' || !trimText(resource.object_key)) {
      res.json({
        playable: false,
        reason: 'OSS 视频尚未上传完成，请先完成上传',
        codec: 'unknown',
        mode: 'oss',
        transcode_status: transcodeStatus,
        progress_percent: transcodeProgress,
      });
      return;
    }
    try {
      const { client } = await getManagedOssRuntime();
      const headResult = await headManagedOssObject({ client, objectKey: resource.object_key });
      const validated = validateManagedOssHeadResult({
        headResult,
        mimeType: resource.mime_type,
        fileSize: resource.file_size,
      });
      res.json({
        playable: true,
        reason: '',
        codec: validated.contentType.startsWith('video/mp4') ? 'h264' : 'unknown',
        mode: 'oss',
        transcode_status: 'none',
        progress_percent: 100,
      });
      return;
    } catch (err) {
      res.json({
        playable: false,
        reason: trimText(err?.message || err) || 'OSS 视频不存在或不可播放，请重新上传',
        codec: 'unknown',
        mode: 'oss',
        transcode_status: 'none',
        progress_percent: transcodeProgress,
      });
      return;
    }
  }

  const filePath = trimText(resource.storage_path);
  if (!filePath) {
    res.json({
      playable: false,
      reason: '尚未上传视频文件，请先上传后再播放',
      codec: 'unknown',
      mode: 'upload',
      transcode_status: transcodeStatus,
      progress_percent: transcodeProgress,
    });
    return;
  }
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    res.json({
      playable: false,
      reason: '视频文件不存在或已失效，请重新上传',
      codec: 'unknown',
      mode: 'upload',
      transcode_status: transcodeStatus,
      progress_percent: transcodeProgress,
    });
    return;
  }

  if (TRANSCODE_ACTIVE_STATUSES.has(transcodeStatus)) {
    res.json({
      playable: false,
      reason: transcodeMessage || '视频正在后台转码，可关闭页面，稍后再播放',
      codec: 'unknown',
      mode: 'upload',
      transcode_status: transcodeStatus,
      progress_percent: transcodeProgress,
    });
    return;
  }

  if (transcodeStatus === 'failed') {
    res.json({
      playable: false,
      reason: transcodeMessage || '视频转码失败，请重新上传',
      codec: 'unknown',
      mode: 'upload',
      transcode_status: transcodeStatus,
      progress_percent: transcodeProgress,
    });
    return;
  }

  const check = await assessVideoPlayability({ resource, filePath });
  res.json({
    playable: !!check.playable,
    reason: trimText(check.reason),
    codec: trimText(check.codec) || 'unknown',
    mode: 'upload',
    transcode_status: transcodeStatus,
    progress_percent: transcodeProgress,
  });
}));

app.get('/api/train-exam/resources/:id/transcode-status', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = ensureResourceReadAccess(req, await getResourceWithCourseById(id));

  const status = normalizeTranscodeStatus(resource.transcode_status, 'none');
  const progressPercent = Math.max(0, Math.min(100, Number(resource.transcode_progress || 0)));
  const message = trimText(resource.transcode_message);
  const jobId = Number(resource.transcode_job_id || 0) || null;

  let job = null;
  if (jobId) {
    job = await get('SELECT * FROM te_resource_transcode_jobs WHERE id = ? LIMIT 1', [jobId]);
  }
  if (!job) {
    job = await get(
      `SELECT *
       FROM te_resource_transcode_jobs
       WHERE resource_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [id]
    );
  }

  res.json({
    resource_id: id,
    status,
    progress_percent: progressPercent,
    message: message || (
      status === 'queued' || status === 'running'
        ? '视频正在后台转码，可关闭页面稍后查看'
        : status === 'succeeded'
          ? '转码完成，可开始播放'
          : status === 'failed'
            ? '转码失败，请重新上传'
            : ''
    ),
    job_id: Number(job?.id || 0) || jobId,
    source_codec: trimText(job?.source_codec),
    target_codec: trimText(job?.target_codec),
    error_message: trimText(job?.error_message),
    updated_at: resource.updated_at || null,
  });
}));

app.get('/api/train-exam/resources/:id/download', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resource = ensureResourceReadAccess(req, await getResourceWithCourseById(id));
  const sourceMode = normalizeSourceMode(resource.source_mode);
  const storageBackend = resolveStorageBackend({
    sourceMode,
    requested: resource.storage_backend,
    fallback: sourceMode === 'external' ? 'external' : 'local',
  });

  if (sourceMode === 'external') {
    return res.redirect(trimText(resource.source_url));
  }

  if (storageBackend === 'oss') {
    const uploadStatus = normalizeUploadStatus(resource.upload_status, trimText(resource.object_key) ? 'ready' : 'pending');
    if (uploadStatus !== 'ready' || !trimText(resource.object_key)) throw appError('资源尚未上传完成', 409);
    const { client, config } = await getManagedOssRuntime();
    const redirectUrl = await createManagedOssPlaybackUrl({
      client,
      objectKey: resource.object_key,
      expiresSeconds: config.playbackExpiresSeconds,
    });
    return res.redirect(302, redirectUrl);
  }

  const filePath = trimText(resource.storage_path);
  if (!filePath) throw appError('资源文件不存在', 404);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw appError('资源文件不存在', 404);

  res.download(filePath, path.basename(filePath));
}));

app.get('/api/train-exam/courses/:id/learning-path', requireReader, asyncHandler(async (req, res) => {
  const course = await getCourseSummaryById(req.params.id);
  ensureCourseReadAccess(req, course);
  const payload = await buildCourseLearningPath({
    courseId: Number(req.params.id),
    userId: Number(req.user.id || 0),
  });
  res.json(payload);
}));

app.post('/api/train-exam/resources/:id/progress', requireReader, asyncHandler(async (req, res) => {
  const resourceId = Number(req.params.id);
  const resource = ensureResourceReadAccess(req, await getResourceWithCourseById(resourceId));

  const userId = Number(req.user.id || 0);
  const username = trimText(req.user.username);
  const existing = await getResourceProgressRow({ userId, resourceId });

  const inputPercent = req.body?.progress_percent !== undefined
    ? clampProgressPercent(req.body.progress_percent)
    : null;
  const viewedIncrement = Math.max(0, Number(req.body?.viewed_seconds_increment || 0));
  const lastPositionInput = req.body?.last_position_seconds !== undefined
    ? Math.max(0, Number(req.body.last_position_seconds || 0))
    : null;
  const markCompleted = normalizeBoolean(req.body?.mark_completed, false);
  const forceWatch = Number(resource.force_watch || 0) === 1 && supportsManagedVideoPlayback({
    resourceType: resource.resource_type,
    sourceMode: resource.source_mode,
    storageBackend: resource.storage_backend,
  });

  const currentPercent = clampProgressPercent(existing?.progress_percent || 0);
  const currentLastPosition = Math.max(0, Number(existing?.last_position_seconds || 0));
  const nextPercent = markCompleted
    ? 100
    : inputPercent === null
      ? currentPercent
      : Math.max(currentPercent, inputPercent);
  const nextViewed = Math.max(0, Number(existing?.viewed_seconds || 0) + viewedIncrement);
  const nextLastPosition = lastPositionInput === null
    ? currentLastPosition
    : lastPositionInput;

  const forceWatchLocked = shouldEnforceManagedVideoForceWatch({
    forceWatchEnabled: forceWatch,
    progressPercent: currentPercent,
    completedAt: existing?.completed_at || null,
  });

  if (forceWatchLocked) {
    if (markCompleted && inputPercent !== 100 && currentPercent < 98) {
      throw appError('当前视频启用强制播放，请完整观看后再完成', 409);
    }
    if (lastPositionInput !== null && lastPositionInput > currentLastPosition + 8) {
      throw appError('当前视频启用强制播放，不允许快进', 409);
    }
    if (!markCompleted && inputPercent !== null && inputPercent > currentPercent + 15) {
      throw appError('当前视频启用强制播放，不允许一次性跳跃进度', 409);
    }
  }
  const completedAt = markCompleted || nextPercent >= 100
    ? toMysqlDatetime(new Date())
    : existing?.completed_at || null;

  if (existing) {
    await run(
      `UPDATE te_resource_progress
       SET progress_percent = ?, viewed_seconds = ?, last_position_seconds = ?, completed_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextPercent, nextViewed, nextLastPosition, completedAt, Number(existing.id)]
    );
  } else {
    await run(
      `INSERT INTO te_resource_progress
        (course_id, resource_id, user_id, username, progress_percent, viewed_seconds, last_position_seconds, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(resource.course_id), resourceId, userId, username, nextPercent, nextViewed, nextLastPosition, completedAt]
    );
  }

  const after = await getResourceProgressRow({ userId, resourceId });
  res.json({
    resource_id: resourceId,
    course_id: Number(resource.course_id),
    progress_percent: clampProgressPercent(after?.progress_percent || 0),
    viewed_seconds: Number(after?.viewed_seconds || 0),
    last_position_seconds: Number(after?.last_position_seconds || 0),
    completed: !!after?.completed_at || clampProgressPercent(after?.progress_percent || 0) >= 100,
    completed_at: after?.completed_at || null,
    updated_at: after?.updated_at || null,
  });
}));

app.get('/api/train-exam/my/learning-progress', requireReader, asyncHandler(async (req, res) => {
  const items = await buildMyLearningProgress({
    userId: Number(req.user.id || 0),
    role: getUserRole(req),
  });
  const totalCourses = items.length;
  const completedCourses = items.filter((item) => Number(item.total_resources || 0) > 0 && Number(item.completed_resources || 0) >= Number(item.total_resources || 0)).length;
  const avgCompletion = totalCourses > 0
    ? Number((items.reduce((acc, item) => acc + Number(item.completion_rate || 0), 0) / totalCourses).toFixed(2))
    : 0;
  res.json({
    summary: {
      total_courses: totalCourses,
      completed_courses: completedCourses,
      average_completion_rate: avgCompletion,
    },
    items,
  });
}));

app.post('/api/train-exam/questions', requireContentWriter, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const questionId = await insertQuestion({
    payload,
    user: req.user,
    sourceType: 'manual',
    generationJobId: null,
    courseId: Number(payload.course_id || 0) || null,
    status: 'draft',
  });

  const created = await getQuestionById(questionId);

  await logOperation({
    req,
    action: 'QUESTION_CREATE',
    entity: 'question',
    entityId: questionId,
    message: '手工创建题目',
    afterData: created,
  });

  res.status(201).json(created);
}));

app.post('/api/train-exam/questions/generation/jobs', requireContentWriter, asyncHandler(async (req, res) => {
  const name = trimText(req.body?.name || `FAQ自动出题任务-${Date.now()}`);
  const sourceCategoryIds = parseIdArray(req.body?.source_category_ids);
  const sourceArticleIds = parseIdArray(req.body?.source_article_ids);

  const payload = {
    source_category_ids: sourceCategoryIds,
    source_article_ids: sourceArticleIds,
    max_sources: Math.max(1, Math.min(Number(req.body?.max_sources || 30), QUESTION_GENERATION_MAX_SOURCES)),
  };

  const result = await run(
    `INSERT INTO te_question_generation_jobs
      (name, status, payload_json, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, 'pending', ?, ?, ?, ?, ?)`,
    [
      name,
      JSON.stringify(payload),
      Number(req.user.id) || null,
      req.user.username,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );

  const id = Number(result.insertId || 0);
  const created = await get('SELECT * FROM te_question_generation_jobs WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'QUESTION_GENERATION_JOB_CREATE',
    entity: 'question_generation_job',
    entityId: id,
    message: `创建自动出题任务 ${name}`,
    afterData: created,
  });

  res.status(201).json(created);
}));

app.get('/api/train-exam/questions/generation/jobs/:id', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await get('SELECT * FROM te_question_generation_jobs WHERE id = ? LIMIT 1', [id]);
  if (!row) throw appError('出题任务不存在', 404);
  const sources = await query('SELECT * FROM te_question_generation_sources WHERE job_id = ? ORDER BY id ASC', [id]);
  res.json({
    ...row,
    payload: parseMaybeJson(row.payload_json, {}),
    result: parseMaybeJson(row.result_json, {}),
    sources,
  });
}));

app.post('/api/train-exam/questions/generation/jobs/:id/run', requireContentWriter, questionGenerationRunRateLimit, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const job = await get('SELECT * FROM te_question_generation_jobs WHERE id = ? LIMIT 1', [id]);
  if (!job) throw appError('出题任务不存在', 404);

  const payload = parseMaybeJson(job.payload_json, {}) || {};
  const sourceCategoryIds = parseIdArray(payload.source_category_ids);
  const sourceArticleIds = parseIdArray(payload.source_article_ids);
  const maxSources = Math.max(1, Math.min(Number(payload.max_sources || 30), QUESTION_GENERATION_MAX_SOURCES));

  if (!sourceCategoryIds.length && !sourceArticleIds.length) {
    throw appError('请至少选择 FAQ 分类或文章作为出题来源', 400);
  }

  await run(
    `UPDATE te_question_generation_jobs
     SET status = 'running', error_message = NULL, updated_by_id = ?, updated_by_name = ?, updated_at = NOW(), ran_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id) || null, req.user.username, id]
  );

  const sources = await getPublishedFaqSources({
    categoryIds: sourceCategoryIds,
    articleIds: sourceArticleIds,
    limit: maxSources,
  });

  if (!sources.length) {
    await run(
      `UPDATE te_question_generation_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      ['未找到可用于出题的FAQ已发布内容', id]
    );
    throw appError('未找到可用于出题的FAQ已发布内容', 404);
  }

  await transaction(async (tx) => {
    await tx.run('DELETE FROM te_question_generation_sources WHERE job_id = ?', [id]);
    for (const row of sources) {
      await tx.run(
        `INSERT INTO te_question_generation_sources
          (job_id, faq_article_id, faq_version_id, source_title, category_id, search_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          Number(row.faq_article_id),
          Number(row.faq_version_id) || null,
          trimText(row.source_title) || null,
          Number(row.category_id) || null,
          trimText(row.search_text) || null,
        ]
      );
    }
  });

  const allQuestions = [];
  for (const source of sources) {
    const tags = ['faq_auto', `faq_article_${source.faq_article_id}`];
    const ruleQuestions = buildRuleQuestions({
      sourceTitle: trimText(source.source_title || `FAQ-${source.faq_article_id}`),
      searchText: trimText(source.search_text),
      tags,
    });
    allQuestions.push(...ruleQuestions);
  }

  let aiQuestions = [];
  let aiError = '';
  let aiLog = null;

  const aiInput = sources
    .slice(0, 8)
    .map((row, idx) => `【${idx + 1}】标题：${trimText(row.source_title)}\n内容：${trimText(row.search_text).slice(0, 1200)}`)
    .join('\n\n');

  try {
    const runtime = await resolveAiRuntime('FAQ_TO_QUESTIONS');
    const aiResult = await callOpenAiCompatible({ runtime, inputText: aiInput });
    aiQuestions = parseAiQuestions(aiResult.content).map((item) => ({
      ...item,
      tags: normalizeTags([...(item.tags || []), 'faq_auto', 'ai_generated']),
    }));

    const insertLog = await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error_message, operator_id, operator_name, request_ip)
       VALUES ('FAQ_TO_QUESTIONS', ?, ?, 'SUCCESS', ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        Number(runtime.model.id || 0) || null,
        trimText(runtime.model.name),
        Number(aiResult.latencyMs || 0),
        Number(aiResult.usage?.prompt_tokens || 0),
        Number(aiResult.usage?.completion_tokens || 0),
        Number(aiResult.usage?.total_tokens || 0),
        Number(req.user.id) || null,
        req.user.username,
        trimText(getClientIp(req)),
      ]
    );
    aiLog = Number(insertLog.insertId || 0);
  } catch (err) {
    aiError = trimText(err.message || 'AI出题失败');
    const insertLog = await run(
      `INSERT INTO te_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, error_message, operator_id, operator_name, request_ip)
       VALUES ('FAQ_TO_QUESTIONS', NULL, ?, 'FAILED', 0, ?, ?, ?, ?)`,
      [
        'default',
        aiError.slice(0, 2000),
        Number(req.user.id) || null,
        req.user.username,
        trimText(getClientIp(req)),
      ]
    );
    aiLog = Number(insertLog.insertId || 0);
  }

  const mergedQuestions = [...allQuestions, ...aiQuestions];
  const dedupSet = new Set();
  const finalQuestions = [];

  for (const item of mergedQuestions) {
    const key = trimText(item.stem).toLowerCase();
    if (!key || dedupSet.has(key)) continue;
    dedupSet.add(key);
    finalQuestions.push(item);
  }

  let insertedCount = 0;
  for (const item of finalQuestions) {
    try {
      await insertQuestion({
        payload: item,
        user: req.user,
        sourceType: 'faq_auto',
        generationJobId: id,
        status: 'draft',
      });
      insertedCount += 1;
    } catch (err) {
      // skip invalid generated item
      console.warn('[train-exam] skip generated question:', err?.message || err);
    }
  }

  const finalStatus = aiError ? 'partial_failed' : 'completed';
  const resultPayload = {
    source_count: sources.length,
    rule_generated: allQuestions.length,
    ai_generated: aiQuestions.length,
    inserted: insertedCount,
    deduplicated_total: finalQuestions.length,
    ai_task_log_id: aiLog,
  };

  await run(
    `UPDATE te_question_generation_jobs
     SET status = ?, result_json = ?, error_message = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      ALLOWED_JOB_STATUSES.has(finalStatus) ? finalStatus : 'completed',
      JSON.stringify(resultPayload),
      aiError || null,
      id,
    ]
  );

  const after = await get('SELECT * FROM te_question_generation_jobs WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'QUESTION_GENERATION_JOB_RUN',
    entity: 'question_generation_job',
    entityId: id,
    message: `执行自动出题任务 ${id}`,
    afterData: {
      status: after?.status,
      result: resultPayload,
      ai_error: aiError || null,
    },
  });

  res.json({
    ...after,
    result: resultPayload,
    ai_error: aiError || null,
  });
}));

app.post('/api/train-exam/questions/generation/jobs/:id/publish', requireQuestionReviewer, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const job = await get('SELECT * FROM te_question_generation_jobs WHERE id = ? LIMIT 1', [id]);
  if (!job) throw appError('出题任务不存在', 404);

  const draftRows = await query(
    `SELECT id FROM te_question_bank
     WHERE generation_job_id = ? AND source_type = 'faq_auto' AND status = 'draft'`,
    [id]
  );

  if (!draftRows.length) throw appError('当前任务无可发布草稿题目', 409);

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE te_question_bank
       SET status = 'published', reviewed_by_id = ?, reviewed_by_name = ?, reviewed_at = NOW(),
           updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE generation_job_id = ? AND source_type = 'faq_auto' AND status = 'draft'`,
      [
        Number(req.user.id) || null,
        req.user.username,
        Number(req.user.id) || null,
        req.user.username,
        id,
      ]
    );

    for (const row of draftRows) {
      await tx.run(
        `INSERT INTO te_question_review_logs (question_id, action, comment, operator_id, operator_name)
         VALUES (?, 'approve', ?, ?, ?)`,
        [Number(row.id), `任务发布：${id}`, Number(req.user.id) || null, req.user.username]
      );
    }

    await tx.run(
      `UPDATE te_question_generation_jobs
       SET status = 'published', published_at = NOW(), updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [Number(req.user.id) || null, req.user.username, id]
    );
  });

  const after = await get('SELECT * FROM te_question_generation_jobs WHERE id = ? LIMIT 1', [id]);

  await logOperation({
    req,
    action: 'QUESTION_GENERATION_JOB_PUBLISH',
    entity: 'question_generation_job',
    entityId: id,
    message: `发布自动出题任务 ${id}`,
    afterData: { published_questions: draftRows.length },
  });

  res.json({
    ...after,
    published_questions: draftRows.length,
  });
}));

app.get('/api/train-exam/questions/import/template', requireReader, asyncHandler(async (_req, res) => {
  const rows = buildQuestionImportTemplateRows();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('questions');
  rows.forEach((row) => {
    worksheet.addRow(Array.isArray(row) ? row : []);
  });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="train-exam-question-template.xlsx"');
  res.send(buffer);
}));

const normalizeExcelCellValue = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return trimText(value.richText.map((item) => trimText(item?.text)).join(''));
    }
    if (value.text !== undefined) return trimText(value.text);
    if (value.result !== undefined) return trimText(value.result);
    if (value.hyperlink !== undefined) return trimText(value.text || value.hyperlink);
  }
  return trimText(value);
};

const normalizeExcelHeaderKey = (value) =>
  trimText(value)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '');

const parseQuestionImportRowsFromWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('工作表为空');

  const rows = [];
  let headers = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values.slice(1).map((item) => normalizeExcelCellValue(item));
    if (rowNumber === 1) {
      headers = values;
      return;
    }
    if (!values.some((item) => trimText(item))) return;
    const payload = {};
    headers.forEach((header, index) => {
      const key = trimText(header);
      if (!key) return;
      const value = values[index] === undefined ? '' : values[index];
      payload[key] = value;
      const aliasKey = normalizeExcelHeaderKey(key);
      if (aliasKey && payload[aliasKey] === undefined) {
        payload[aliasKey] = value;
      }
    });
    rows.push(payload);
  });

  return rows;
};

app.post('/api/train-exam/questions/import/jobs', requireContentWriter, importRateLimit, uploadLimited.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw appError('缺少导入文件', 400);

  const ext = path.extname(trimText(req.file.originalname)).toLowerCase();
  if (ext !== '.xlsx') throw appError('仅支持 .xlsx 文件导入', 400);
  const canReviewImportedQuestions = canReviewQuestions(req);
  const publishAfterImport = normalizeBoolean(req.body?.publish_after_import, canReviewImportedQuestions);
  const importedQuestionStatus = resolveImportQuestionStatus({
    publishAfterImport,
    canReview: canReviewImportedQuestions,
  });

  const storagePath = await writeUploadFile(IMPORT_ROOT, req.file.originalname, req.file.buffer);

  const insert = await run(
    `INSERT INTO te_import_jobs
      (status, file_name, storage_path, created_by_id, created_by_name)
     VALUES ('running', ?, ?, ?, ?)`,
    [req.file.originalname, storagePath, Number(req.user.id) || null, req.user.username]
  );
  const jobId = Number(insert.insertId || 0);

  let rows = [];
  try {
    rows = await parseQuestionImportRowsFromWorkbook(req.file.buffer);
  } catch (err) {
    await run(
      `UPDATE te_import_jobs
       SET status = 'failed', error_rows_json = ?, failed_rows = 1, total_rows = 0, finished_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify([{ row: 0, error: trimText(err.message || '解析Excel失败') }]), jobId]
    );
    throw appError('解析Excel失败', 400);
  }

  if (rows.length > QUESTION_IMPORT_MAX_ROWS) {
    throw appError(`导入行数超过限制，最大 ${QUESTION_IMPORT_MAX_ROWS}`, 400);
  }

  let success = 0;
  let published = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    try {
      const options = [];
      const optionFieldMap = [
        ['A', row.option_a || row.选项A],
        ['B', row.option_b || row.选项B],
        ['C', row.option_c || row.选项C],
        ['D', row.option_d || row.选项D],
        ['E', row.option_e || row.选项E],
        ['F', row.option_f || row.选项F],
      ];
      for (const [key, text] of optionFieldMap) {
        if (!trimText(text)) continue;
        options.push({ key, text: trimText(text) });
      }

      const legacyOptions = parseMaybeJson(row.options_json || row.选项 || '[]', []);
      const mergedOptions = options.length ? options : (Array.isArray(legacyOptions) ? legacyOptions : []);
      const payload = {
        stem: row.stem || row.题干,
        question_category: row.question_category || row.category || row.分类 || '',
        question_type: row.question_type || row.题型,
        difficulty: row.difficulty || row.难度,
        points: row.points || row.分值,
        options: mergedOptions,
        answer: row.answer_values || row.答案值 || row.correct_answers || row.正确答案 || parseMaybeJson(row.answer_json || row.答案 || '[]', []),
        answer_text: row.answer_text || row.标准答案文本 || '',
        answer_aliases: row.answer_aliases || row.同义答案 || parseMaybeJson(row.answer_aliases_json || row.同义答案JSON || '[]', []),
        explanation: row.explanation || row.解析,
        tags: row.tags || row.标签,
      };
      await insertQuestion({
        payload,
        user: req.user,
        sourceType: 'import',
        status: importedQuestionStatus,
        reviewer: importedQuestionStatus === 'published' ? req.user : null,
        reviewComment: 'Excel导入直接发布',
      });
      if (importedQuestionStatus === 'published') {
        published += 1;
      }
      success += 1;
    } catch (err) {
      errors.push({ row: i + 2, error: trimText(err.message || '导入失败') });
    }
  }

  const failed = errors.length;
  const draft = Math.max(0, success - published);
  const status = failed > 0 ? (success > 0 ? 'partial_failed' : 'failed') : 'completed';

  await run(
    `UPDATE te_import_jobs
     SET status = ?, total_rows = ?, success_rows = ?, failed_rows = ?, error_rows_json = ?, finished_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [status, rows.length, success, failed, JSON.stringify(errors), jobId]
  );

  const result = await get('SELECT * FROM te_import_jobs WHERE id = ? LIMIT 1', [jobId]);

  await logOperation({
    req,
    action: 'QUESTION_IMPORT',
    entity: 'import_job',
    entityId: jobId,
    message: `导入题库 ${req.file.originalname}`,
    afterData: {
      total: rows.length,
      success,
      failed,
      published,
      draft,
      publish_after_import: importedQuestionStatus === 'published',
    },
  });

  res.status(201).json({
    ...result,
    errors,
    published_rows: published,
    draft_rows: draft,
    publish_after_import_requested: publishAfterImport,
    publish_after_import_effective: importedQuestionStatus === 'published',
  });
}));

app.get('/api/train-exam/questions/import/jobs/:id', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await get('SELECT * FROM te_import_jobs WHERE id = ? LIMIT 1', [id]);
  if (!row) throw appError('导入任务不存在', 404);
  res.json({
    ...row,
    errors: parseMaybeJson(row.error_rows_json, []),
  });
}));

app.get('/api/train-exam/question-categories', requireReader, asyncHandler(async (_req, res) => {
  const rows = await listQuestionCategoryRows();
  res.json(rows);
}));

app.post('/api/train-exam/question-categories', requireContentWriter, asyncHandler(async (req, res) => {
  const name = normalizeQuestionCategory(req.body?.name || req.body?.category_name, '');
  if (!name) throw appError('分类名称不能为空', 400);

  const exists = await get('SELECT id FROM te_question_categories WHERE name = ? LIMIT 1', [name]);
  if (exists) throw appError('分类已存在', 409);

  const result = await run(
    `INSERT INTO te_question_categories
      (name, is_system, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, 0, ?, ?, ?, ?)`,
    [
      name,
      Number(req.user?.id) || null,
      trimText(req.user?.username) || null,
      Number(req.user?.id) || null,
      trimText(req.user?.username) || null,
    ]
  );

  const id = Number(result.insertId || 0);
  const row = await get(
    `SELECT
      c.id,
      c.name,
      c.is_system,
      c.created_at,
      c.updated_at,
      COUNT(q.id) AS question_count,
      SUM(CASE WHEN q.status = 'published' THEN 1 ELSE 0 END) AS published_question_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'single_choice' THEN 1 ELSE 0 END) AS published_single_choice_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'multiple_choice' THEN 1 ELSE 0 END) AS published_multiple_choice_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'judgement' THEN 1 ELSE 0 END) AS published_judgement_count,
      SUM(CASE WHEN q.status = 'published' AND q.question_type = 'fill_blank' THEN 1 ELSE 0 END) AS published_fill_blank_count
     FROM te_question_categories c
     LEFT JOIN te_question_bank q ON q.question_category = c.name
     WHERE c.id = ?
     GROUP BY c.id, c.name, c.is_system, c.created_at, c.updated_at`,
    [id]
  );

  await logOperation({
    req,
    action: 'QUESTION_CATEGORY_CREATE',
    entity: 'question_category',
    entityId: id,
    message: `创建题目分类 ${name}`,
    afterData: row,
  });

  res.status(201).json(normalizeQuestionCategoryRow(row));
}));

app.put('/api/train-exam/question-categories/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw appError('分类ID无效', 400);
  const before = await get('SELECT * FROM te_question_categories WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('分类不存在', 404);

  const nextName = normalizeQuestionCategory(req.body?.name || req.body?.category_name, '');
  if (!nextName) throw appError('分类名称不能为空', 400);
  if (nextName === trimText(before.name)) {
    const rows = await listQuestionCategoryRows();
    const same = rows.find((item) => Number(item.id || 0) === id) || null;
    return res.json(same || normalizeQuestionCategoryRow({ id, name: nextName }));
  }

  const conflict = await get('SELECT id FROM te_question_categories WHERE name = ? AND id <> ? LIMIT 1', [nextName, id]);
  if (conflict) throw appError('分类名称已存在', 409);

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE te_question_categories
       SET name = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextName, Number(req.user?.id) || null, trimText(req.user?.username) || null, id]
    );
    await tx.run(
      `UPDATE te_question_bank
       SET question_category = ?, updated_at = NOW()
       WHERE question_category = ?`,
      [nextName, trimText(before.name)]
    );
  });

  const rows = await listQuestionCategoryRows();
  const after = rows.find((item) => Number(item.id || 0) === id) || null;

  await logOperation({
    req,
    action: 'QUESTION_CATEGORY_UPDATE',
    entity: 'question_category',
    entityId: id,
    message: `修改题目分类 ${trimText(before.name)} -> ${nextName}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after || normalizeQuestionCategoryRow({ id, name: nextName }));
}));

app.delete('/api/train-exam/question-categories/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw appError('分类ID无效', 400);
  const row = await get('SELECT * FROM te_question_categories WHERE id = ? LIMIT 1', [id]);
  if (!row) throw appError('分类不存在', 404);

  const fallbackName = '未分类';
  await upsertQuestionCategory({
    categoryName: fallbackName,
    user: req.user,
    isSystem: true,
  });

  const affected = await transaction(async (tx) => {
    const updateRes = await tx.run(
      `UPDATE te_question_bank
       SET question_category = ?, updated_at = NOW()
       WHERE question_category = ?`,
      [fallbackName, trimText(row.name)]
    );
    await tx.run('DELETE FROM te_question_categories WHERE id = ?', [id]);
    return Number(updateRes?.affectedRows || 0);
  });

  await logOperation({
    req,
    action: 'QUESTION_CATEGORY_DELETE',
    entity: 'question_category',
    entityId: id,
    message: `删除题目分类 ${trimText(row.name)}`,
    beforeData: row,
    afterData: {
      reassigned_to: fallbackName,
      reassigned_question_count: affected,
    },
  });

  res.json({
    deleted_id: id,
    reassigned_question_count: affected,
    fallback_category: fallbackName,
  });
}));

app.get('/api/train-exam/questions', requireReader, asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 10);
  const { whereSql, params } = buildQuestionFilterWhere(req.query || {});
  const totalRow = await get(`SELECT COUNT(1) AS total FROM te_question_bank ${whereSql}`, params);
  const total = Number(totalRow?.total || 0);
  const offset = (page - 1) * limit;

  const rows = await query(
    `SELECT * FROM te_question_bank ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const items = [];
  for (const row of rows) {
    const detail = await getQuestionById(row.id);
    items.push(detail);
  }

  const categories = await listQuestionCategoryNames();
  const totalPages = Math.max(1, Math.ceil(total / limit));

  res.json({
    items,
    total,
    page,
    limit,
    total_pages: totalPages,
    categories,
  });
}));

app.post('/api/train-exam/questions/bulk-publish', requireQuestionReviewer, asyncHandler(async (req, res) => {
  const requestedIds = parseIdArray(req.body?.question_ids || req.body?.ids);
  const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : null;
  if (!requestedIds.length && !filters) throw appError('请先选择要发布的题目或提供筛选条件', 400);

  let targetRows = [];
  const failed = [];

  if (requestedIds.length) {
    targetRows = await query(
      `SELECT id, status
       FROM te_question_bank
       WHERE id IN (${requestedIds.map(() => '?').join(',')})`,
      requestedIds
    );
    const foundIds = new Set(targetRows.map((item) => Number(item.id || 0)).filter((id) => id > 0));
    requestedIds
      .filter((id) => !foundIds.has(Number(id || 0)))
      .forEach((id) => failed.push({
        question_id: Number(id || 0),
        error: '题目不存在',
      }));
  } else {
    const { whereSql, params } = buildQuestionFilterWhere(filters || {});
    targetRows = await query(
      `SELECT id, status
       FROM te_question_bank
       ${whereSql}
       ORDER BY id DESC`,
      params
    );
  }

  const publishedIds = [];
  const skippedIds = [];
  targetRows.forEach((item) => {
    const id = Number(item.id || 0);
    const status = trimText(item.status).toLowerCase();
    if (!id) return;
    if (status === 'draft') {
      publishedIds.push(id);
      return;
    }
    skippedIds.push(id);
  });

  if (publishedIds.length) {
    await transaction(async (tx) => {
      await tx.run(
        `UPDATE te_question_bank
         SET status = 'published', reviewed_by_id = ?, reviewed_by_name = ?, reviewed_at = NOW(), review_comment = ?,
             updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id IN (${publishedIds.map(() => '?').join(',')})`,
        [
          Number(req.user.id) || null,
          req.user.username,
          '批量发布',
          Number(req.user.id) || null,
          req.user.username,
          ...publishedIds,
        ]
      );

      for (const id of publishedIds) {
        await tx.run(
          `INSERT INTO te_question_review_logs (question_id, action, comment, operator_id, operator_name)
           VALUES (?, 'approve', ?, ?, ?)`,
          [id, '批量发布', Number(req.user.id) || null, req.user.username]
        );
      }
    });
  }

  await logOperation({
    req,
    action: 'QUESTION_BULK_PUBLISH',
    entity: 'question',
    entityId: publishedIds[0] || requestedIds[0] || 0,
    message: requestedIds.length
      ? `批量发布题目 ${publishedIds.length} 道`
      : `按筛选条件批量发布题目 ${publishedIds.length} 道`,
    afterData: {
      question_ids: requestedIds.length ? requestedIds : null,
      filters: requestedIds.length ? null : filters,
      published_count: publishedIds.length,
      skipped_count: skippedIds.length,
      failed_count: failed.length,
    },
  });

  res.json({
    success: true,
    published_count: publishedIds.length,
    skipped_count: skippedIds.length,
    failed_count: failed.length,
    published_ids: publishedIds,
    skipped_ids: skippedIds,
    failed,
  });
}));

app.put('/api/train-exam/questions/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await getQuestionById(id);
  if (!before) throw appError('题目不存在', 404);

  await updateQuestion({
    questionId: id,
    payload: req.body || {},
    user: req.user,
    fallbackCategory: trimText(before?.question_category) || getDefaultQuestionCategoryBySource(before?.source_type),
  });

  const after = await getQuestionById(id);

  await logOperation({
    req,
    action: 'QUESTION_UPDATE',
    entity: 'question',
    entityId: id,
    message: `更新题目 ${id}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

app.post('/api/train-exam/questions/bulk-delete', requireContentWriter, asyncHandler(async (req, res) => {
  const ids = parseIdArray(req.body?.question_ids || req.body?.ids);
  if (!ids.length) throw appError('请先选择要删除的题目', 400);
  const force = normalizeBoolean(req.body?.force, true);

  const deletedIds = [];
  const failed = [];

  for (const id of ids) {
    try {
      const result = await deleteQuestionCascade({ questionId: id, force });
      deletedIds.push(id);
      await logOperation({
        req,
        action: 'QUESTION_DELETE',
        entity: 'question',
        entityId: id,
        message: `批量删除题目 ${id}`,
        beforeData: result.before,
        afterData: {
          removed_paper_bindings: result.removedPaperBindings,
          force,
        },
      });
    } catch (err) {
      failed.push({
        question_id: id,
        error: trimText(err?.message || '删除失败') || '删除失败',
      });
    }
  }

  res.json({
    success: true,
    force,
    success_count: deletedIds.length,
    failed_count: failed.length,
    deleted_ids: deletedIds,
    failed,
  });
}));

app.delete('/api/train-exam/questions/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const force = normalizeBoolean(req.query?.force, false);
  const result = await deleteQuestionCascade({ questionId: id, force });

  await logOperation({
    req,
    action: 'QUESTION_DELETE',
    entity: 'question',
    entityId: id,
    message: `删除题目 ${id}`,
    beforeData: result.before,
    afterData: {
      removed_paper_bindings: result.removedPaperBindings,
      force,
    },
  });

  res.json({
    success: true,
    force,
    removed_paper_bindings: result.removedPaperBindings,
  });
}));

app.post('/api/train-exam/questions/:id/review', requireQuestionReviewer, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const actionInput = trimText(req.body?.action).toLowerCase();
  const action = actionInput === '通过' ? 'approve' : actionInput === '驳回' ? 'reject' : actionInput;
  const comment = trimText(req.body?.comment);
  if (!['approve', 'reject'].includes(action)) throw appError('审核动作仅支持：通过/驳回', 400);

  const before = await getQuestionById(id);
  if (!before) throw appError('题目不存在', 404);

  const nextStatus = action === 'approve' ? 'published' : 'archived';

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE te_question_bank
       SET status = ?, reviewed_by_id = ?, reviewed_by_name = ?, reviewed_at = NOW(), review_comment = ?,
           updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        nextStatus,
        Number(req.user.id) || null,
        req.user.username,
        comment || null,
        Number(req.user.id) || null,
        req.user.username,
        id,
      ]
    );
    await tx.run(
      `INSERT INTO te_question_review_logs (question_id, action, comment, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?)`,
      [id, action, comment || null, Number(req.user.id) || null, req.user.username]
    );
  });

  const after = await getQuestionById(id);

  await logOperation({
    req,
    action: 'QUESTION_REVIEW',
    entity: 'question',
    entityId: id,
    message: `${action === 'approve' ? '通过' : '拒绝'}题目 ${id}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

const replacePaperRules = async ({ tx, paperId, rules = [] }) => {
  await tx.run('DELETE FROM te_paper_question_rules WHERE paper_id = ?', [paperId]);
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i] || {};
    await tx.run(
      `INSERT INTO te_paper_question_rules
        (paper_id, question_type, difficulty, question_categories_json, tags_json, question_count, points_per_question, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paperId,
        trimText(rule.question_type) || null,
        trimText(rule.difficulty) || null,
        JSON.stringify(normalizePaperRuleCategories(rule.question_categories)),
        JSON.stringify(normalizeTags(rule.tags)),
        Math.max(1, Number(rule.question_count || 1)),
        Math.max(1, Number(rule.points_per_question || 1)),
        i,
      ]
    );
  }
};

const replacePaperFixedQuestions = async ({ tx, paperId, fixedQuestionIds = [] }) => {
  await tx.run('DELETE FROM te_paper_questions WHERE paper_id = ?', [paperId]);
  for (let i = 0; i < fixedQuestionIds.length; i += 1) {
    const qid = Number(fixedQuestionIds[i]);
    const snapshot = await buildQuestionSnapshot(qid, null);
    await tx.run(
      `INSERT INTO te_paper_questions
        (paper_id, question_id, question_snapshot_json, points, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [paperId, qid, JSON.stringify(snapshot), Number(snapshot.points || 1), i]
    );
  }
};

const loadPaperDetail = async (paperId) => {
  const paper = await get('SELECT * FROM te_papers WHERE id = ? LIMIT 1', [paperId]);
  if (!paper) return null;
  const rules = await query('SELECT * FROM te_paper_question_rules WHERE paper_id = ? ORDER BY sort_order ASC, id ASC', [paperId]);
  const fixedQuestions = await query('SELECT * FROM te_paper_questions WHERE paper_id = ? ORDER BY sort_order ASC, id ASC', [paperId]);
  return {
    ...paper,
    rules: rules.map((item) => ({
      ...item,
      tags: parseMaybeJson(item.tags_json, []),
      question_categories: normalizePaperRuleCategories(parseMaybeJson(item.question_categories_json, [])),
    })),
    fixed_questions: fixedQuestions.map((item) => ({
      id: item.id,
      question_id: Number(item.question_id),
      points: Number(item.points || 0),
      sort_order: Number(item.sort_order || 0),
      snapshot: parseMaybeJson(item.question_snapshot_json, {}),
    })),
  };
};

const activateDueScheduledPapers = async () => {
  await run(
    `UPDATE te_papers
     SET status = 'published',
         published_at = COALESCE(scheduled_publish_at, UTC_TIMESTAMP()),
         scheduled_publish_at = NULL,
         archived_at = NULL,
         updated_at = NOW()
     WHERE status = ?
       AND scheduled_publish_at IS NOT NULL
       AND scheduled_publish_at <= UTC_TIMESTAMP()`,
    [SCHEDULED_PAPER_STATUS]
  );
};

const ensurePaperPublishable = (paper) => {
  if (trimText(paper.paper_mode) === 'fixed' && (!paper.fixed_questions || !paper.fixed_questions.length)) {
    throw appError('固定试卷没有题目，不能发布', 409);
  }
  if (trimText(paper.paper_mode) === 'random' && (!paper.rules || !paper.rules.length)) {
    throw appError('随机试卷缺少抽题规则，不能发布', 409);
  }
};

app.get('/api/train-exam/papers', requireReader, asyncHandler(async (req, res) => {
  await activateDueScheduledPapers();
  const where = [];
  if (!isElevatedTrainExamReader(req)) {
    where.push("p.status = 'published'");
    where.push("(p.course_id IS NULL OR c.status = 'published')");
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT p.*
     FROM te_papers p
     LEFT JOIN te_courses c ON c.id = p.course_id
     ${whereSql}
     ORDER BY p.id DESC`
  );
  res.json(rows);
}));

app.post('/api/train-exam/papers', requireContentWriter, asyncHandler(async (req, res) => {
  const name = trimText(req.body?.name);
  if (!name) throw appError('试卷名称不能为空', 400);

  const description = trimText(req.body?.description);
  const paperMode = normalizePaperMode(req.body?.paper_mode, 'fixed');
  const passScore = Math.max(0, Math.min(100, Number(req.body?.pass_score || 80)));
  const durationMinutes = Math.max(10, Math.min(600, Number(req.body?.duration_minutes || 60)));
  const maxAttempts = Math.max(1, Math.min(20, Number(req.body?.max_attempts || 3)));
  const courseId = Number(req.body?.course_id || 0) || null;
  const fixedQuestionIds = parseIdArray(req.body?.fixed_question_ids);
  const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];

  if (paperMode === 'fixed' && !fixedQuestionIds.length) {
    throw appError('固定试卷必须提供 fixed_question_ids', 400);
  }
  if (paperMode === 'random' && !rules.length) {
    throw appError('随机试卷必须提供 rules', 400);
  }

  const created = await transaction(async (tx) => {
    const insert = await tx.run(
      `INSERT INTO te_papers
        (name, description, paper_mode, course_id, pass_score, duration_minutes, max_attempts, status, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        name,
        description || null,
        paperMode,
        courseId,
        passScore,
        durationMinutes,
        maxAttempts,
        Number(req.user.id) || null,
        req.user.username,
        Number(req.user.id) || null,
        req.user.username,
      ]
    );
    const paperId = Number(insert.insertId || 0);

    if (paperMode === 'fixed') {
      await replacePaperFixedQuestions({ tx, paperId, fixedQuestionIds });
    } else {
      await replacePaperRules({ tx, paperId, rules });
    }

    return paperId;
  });

  const detail = await loadPaperDetail(created);

  await logOperation({
    req,
    action: 'PAPER_CREATE',
    entity: 'paper',
    entityId: created,
    message: `创建试卷 ${name}`,
    afterData: detail,
  });

  res.status(201).json(detail);
}));

app.get('/api/train-exam/papers/:id', requireReader, asyncHandler(async (req, res) => {
  await activateDueScheduledPapers();
  const id = Number(req.params.id);
  ensurePaperReadAccess(req, await getPaperAccessRowById(id));
  const paper = await loadPaperDetail(id);
  res.json(paper);
}));

app.put('/api/train-exam/papers/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadPaperDetail(id);
  if (!before) throw appError('试卷不存在', 404);

  const name = trimText(req.body?.name || before.name);
  if (!name) throw appError('试卷名称不能为空', 400);
  const description = req.body?.description !== undefined ? trimText(req.body.description) : before.description;
  const paperMode = req.body?.paper_mode ? normalizePaperMode(req.body.paper_mode, before.paper_mode) : before.paper_mode;
  const passScore = req.body?.pass_score !== undefined ? Math.max(0, Math.min(100, Number(req.body.pass_score || 80))) : Number(before.pass_score || 80);
  const durationMinutes = req.body?.duration_minutes !== undefined
    ? Math.max(10, Math.min(600, Number(req.body.duration_minutes || 60)))
    : Number(before.duration_minutes || 60);
  const maxAttempts = req.body?.max_attempts !== undefined
    ? Math.max(1, Math.min(20, Number(req.body.max_attempts || 3)))
    : Number(before.max_attempts || 3);

  const fixedQuestionIds = parseIdArray(req.body?.fixed_question_ids);
  const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];

  if (paperMode === 'fixed' && !fixedQuestionIds.length && req.body?.fixed_question_ids !== undefined) {
    throw appError('固定试卷必须提供 fixed_question_ids', 400);
  }
  if (paperMode === 'random' && !rules.length && req.body?.rules !== undefined) {
    throw appError('随机试卷必须提供 rules', 400);
  }

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE te_papers
       SET name = ?, description = ?, paper_mode = ?, pass_score = ?, duration_minutes = ?, max_attempts = ?,
           updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        name,
        description || null,
        paperMode,
        passScore,
        durationMinutes,
        maxAttempts,
        Number(req.user.id) || null,
        req.user.username,
        id,
      ]
    );

    if (paperMode === 'fixed') {
      if (req.body?.fixed_question_ids !== undefined) {
        await replacePaperFixedQuestions({ tx, paperId: id, fixedQuestionIds });
      }
      await tx.run('DELETE FROM te_paper_question_rules WHERE paper_id = ?', [id]);
    } else {
      if (req.body?.rules !== undefined) {
        await replacePaperRules({ tx, paperId: id, rules });
      }
      await tx.run('DELETE FROM te_paper_questions WHERE paper_id = ?', [id]);
    }
  });

  const after = await loadPaperDetail(id);

  await logOperation({
    req,
    action: 'PAPER_UPDATE',
    entity: 'paper',
    entityId: id,
    message: `更新试卷 ${id}`,
    beforeData: before,
    afterData: after,
  });

  res.json(after);
}));

app.post('/api/train-exam/papers/:id/publish', requirePaperPublisher, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadPaperDetail(id);
  if (!before) throw appError('试卷不存在', 404);
  if (trimText(before.status) === 'published') return res.json(before);

  ensurePaperPublishable(before);

  await run(
    `UPDATE te_papers
     SET status = 'published', published_at = UTC_TIMESTAMP(), scheduled_publish_at = NULL, archived_at = NULL,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id) || null, req.user.username, id]
  );

  const after = await loadPaperDetail(id);

  await logOperation({
    req,
    action: 'PAPER_PUBLISH',
    entity: 'paper',
    entityId: id,
    message: `发布试卷 ${id}`,
    beforeData: { status: before.status },
    afterData: { status: after.status },
  });

  res.json(after);
}));

app.post('/api/train-exam/papers/:id/schedule-publish', requirePaperPublisher, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadPaperDetail(id);
  if (!before) throw appError('试卷不存在', 404);
  if (trimText(before.status) === 'published') throw appError('试卷已发布，不能设置定时发布', 409);
  if (trimText(before.status) === 'archived') throw appError('已归档试卷不能设置定时发布', 409);

  ensurePaperPublishable(before);
  const scheduledPublishAt = normalizeScheduledPublishAt(req.body?.scheduled_publish_at);

  await run(
    `UPDATE te_papers
     SET status = ?, scheduled_publish_at = ?, published_at = NULL, archived_at = NULL,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [SCHEDULED_PAPER_STATUS, scheduledPublishAt, Number(req.user.id) || null, req.user.username, id]
  );

  const after = await loadPaperDetail(id);

  await logOperation({
    req,
    action: 'PAPER_SCHEDULE_PUBLISH',
    entity: 'paper',
    entityId: id,
    message: `定时发布试卷 ${id}`,
    beforeData: { status: before.status, scheduled_publish_at: before.scheduled_publish_at || null },
    afterData: { status: after.status, scheduled_publish_at: after.scheduled_publish_at || null },
  });

  res.json(after);
}));

app.post('/api/train-exam/papers/:id/archive', requirePaperPublisher, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadPaperDetail(id);
  if (!before) throw appError('试卷不存在', 404);

  await run(
    `UPDATE te_papers
     SET status = 'archived', archived_at = NOW(), scheduled_publish_at = NULL,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id) || null, req.user.username, id]
  );

  const after = await loadPaperDetail(id);

  await logOperation({
    req,
    action: 'PAPER_ARCHIVE',
    entity: 'paper',
    entityId: id,
    message: `归档试卷 ${id}`,
    beforeData: { status: before.status },
    afterData: { status: after.status },
  });

  res.json(after);
}));

app.post('/api/train-exam/papers/bulk-delete', requireContentWriter, asyncHandler(async (req, res) => {
  const ids = parseIdArray(req.body?.paper_ids || req.body?.ids);
  if (!ids.length) throw appError('请先选择要删除的试卷', 400);
  const force = normalizeBoolean(req.body?.force, true);

  const deletedIds = [];
  const failed = [];

  for (const id of ids) {
    try {
      const result = await deletePaperCascade({ paperId: id, force });
      deletedIds.push(id);
      await logOperation({
        req,
        action: 'PAPER_DELETE',
        entity: 'paper',
        entityId: id,
        message: `批量删除试卷 ${result.before.name}`,
        beforeData: result.before,
        afterData: {
          removed_answers: result.removedAnswers,
          removed_advices: result.removedAdvices,
          removed_certificates: result.removedCertificates,
          removed_certificate_files: result.removedCertificateFiles,
          removed_recert_jobs: result.removedRecertJobs,
          removed_results: result.removedResults,
          removed_sessions: result.removedSessions,
          removed_rules: result.removedRules,
          removed_fixed_questions: result.removedFixedQuestions,
          force,
        },
      });
    } catch (err) {
      failed.push({
        paper_id: id,
        error: trimText(err?.message || '删除失败') || '删除失败',
      });
    }
  }

  res.json({
    success: true,
    force,
    success_count: deletedIds.length,
    failed_count: failed.length,
    deleted_ids: deletedIds,
    failed,
  });
}));

app.delete('/api/train-exam/papers/:id', requireContentWriter, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const force = normalizeBoolean(req.query?.force, false);
  const result = await deletePaperCascade({ paperId: id, force });

  await logOperation({
    req,
    action: 'PAPER_DELETE',
    entity: 'paper',
    entityId: id,
    message: `删除试卷 ${result.before.name}`,
    beforeData: result.before,
    afterData: {
      removed_answers: result.removedAnswers,
      removed_advices: result.removedAdvices,
      removed_certificates: result.removedCertificates,
      removed_certificate_files: result.removedCertificateFiles,
      removed_recert_jobs: result.removedRecertJobs,
      removed_results: result.removedResults,
      removed_sessions: result.removedSessions,
      removed_rules: result.removedRules,
      removed_fixed_questions: result.removedFixedQuestions,
      force,
    },
  });

  res.json({
    success: true,
    force,
    removed_answers: result.removedAnswers,
    removed_advices: result.removedAdvices,
    removed_certificates: result.removedCertificates,
    removed_certificate_files: result.removedCertificateFiles,
    removed_recert_jobs: result.removedRecertJobs,
    removed_results: result.removedResults,
    removed_sessions: result.removedSessions,
    removed_rules: result.removedRules,
    removed_fixed_questions: result.removedFixedQuestions,
  });
}));

const buildRandomQuestionsByRules = async (rules) => {
  const selected = [];
  for (const rule of rules) {
    const where = ["status = 'published'"];
    const params = [];
    const questionType = trimText(rule.question_type).toLowerCase();
    const difficulty = trimText(rule.difficulty).toLowerCase();
    const questionCount = Math.max(1, Number(rule.question_count || 1));
    const pointsPerQuestion = Math.max(1, Number(rule.points_per_question || 1));
    const tags = Array.isArray(rule.tags) ? rule.tags : parseMaybeJson(rule.tags_json, []);
    const questionCategories = normalizePaperRuleCategories(
      Array.isArray(rule.question_categories) ? rule.question_categories : parseMaybeJson(rule.question_categories_json, [])
    );

    if (questionType) {
      where.push('question_type = ?');
      params.push(questionType);
    }
    if (difficulty) {
      where.push('difficulty = ?');
      params.push(difficulty);
    }
    if (questionCategories.length) {
      where.push(`question_category IN (${questionCategories.map(() => '?').join(',')})`);
      params.push(...questionCategories);
    }

    const candidates = await query(
      `SELECT * FROM te_question_bank WHERE ${where.join(' AND ')} ORDER BY RAND() LIMIT ?`,
      [...params, questionCount * 5]
    );

    const filtered = candidates.filter((item) => {
      if (!tags.length) return true;
      const itemTags = parseMaybeJson(item.tags_json, []);
      return tags.every((tag) => itemTags.includes(tag));
    });

    const chosen = filtered.slice(0, questionCount);
    for (const row of chosen) {
      const snapshot = await buildQuestionSnapshot(row.id, pointsPerQuestion);
      selected.push(snapshot);
    }
  }
  return selected;
};

const normalizeSnapshotForSession = ({ snapshot, standardAnswer, pointsOverride = null, fallbackQuestionId = 0 }) => {
  const rawSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const rawStandard = standardAnswer && typeof standardAnswer === 'object' ? standardAnswer : {};
  const snapshotStandard = rawSnapshot.standard_answer && typeof rawSnapshot.standard_answer === 'object'
    ? rawSnapshot.standard_answer
    : {};
  const questionId = Number(rawSnapshot.question_id || fallbackQuestionId || 0);
  if (!questionId) return null;

  const questionType = normalizeQuestionType(
    rawSnapshot.question_type || rawStandard.question_type,
    'single_choice'
  );
  const pointsRaw = Number.isFinite(Number(pointsOverride))
    ? Number(pointsOverride)
    : Number(rawSnapshot.points || 1);

  return {
    question_id: questionId,
    stem: trimText(rawSnapshot.stem),
    question_type: questionType,
    difficulty: normalizeDifficulty(rawSnapshot.difficulty, 'medium'),
    question_category: trimText(rawSnapshot.question_category || rawSnapshot.category)
      ? normalizeQuestionCategory(rawSnapshot.question_category || rawSnapshot.category, '未分类')
      : '',
    explanation: trimText(rawSnapshot.explanation),
    tags: normalizeTags(rawSnapshot.tags),
    points: Number.isFinite(pointsRaw) && pointsRaw > 0 ? Number(pointsRaw) : 1,
    options: Array.isArray(rawSnapshot.options)
      ? rawSnapshot.options
          .map((item) => ({
            key: trimText(item?.key),
            text: trimText(item?.text),
          }))
          .filter((item) => item.key || item.text)
      : [],
    standard_answer: {
      answer_values: parseTextList(rawStandard.answer_values ?? snapshotStandard.answer_values, { upper: false }),
      answer_text: trimText(rawStandard.answer_text ?? snapshotStandard.answer_text),
      answer_aliases: parseTextList(rawStandard.answer_aliases ?? snapshotStandard.answer_aliases, { upper: false }),
      question_type: questionType,
    },
  };
};

const createExamSessionWithSnapshots = async ({
  paperId,
  user,
  attemptNo,
  durationMinutes,
  passScore,
  maxAttempts,
  snapshots,
  req = null,
  operationAction = 'EXAM_START',
  operationMessage = '',
  operationAfterData = null,
  retakeOpportunityId = 0,
}) => {
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];
  if (!safeSnapshots.length) throw appError('试卷没有可用题目，无法开始考试', 409);
  const userId = Number(user?.id || 0);
  const userOrg = await resolveUserOrgProfile({ userId, username: user?.username });

  const shuffled = [...safeSnapshots]
    .map((item) => ({ ...item, __k: Math.random() }))
    .sort((a, b) => a.__k - b.__k)
    .map((item) => {
      const next = { ...item };
      delete next.__k;
      return next;
    });

  const sessionId = await transaction(async (tx) => {
    if (Number(retakeOpportunityId || 0) > 0) {
      const consumed = await consumeRetakeOpportunity({ tx, opportunityId: retakeOpportunityId });
      if (!consumed) throw appError('补考机会已被使用，请刷新后重试', 409);
    }

    const insert = await tx.run(
      `INSERT INTO te_exam_sessions
        (paper_id, user_id, username, user_department, user_position, attempt_no, status, started_at, duration_minutes, pass_score, max_attempts)
       VALUES (?, ?, ?, ?, ?, ?, 'started', NOW(), ?, ?, ?)`,
      [
        Number(paperId || 0),
        userId,
        trimText(user?.username),
        userOrg.department,
        userOrg.position_title,
        Number(attemptNo || 1),
        Number(durationMinutes || 60),
        Number(passScore || 80),
        Number(maxAttempts || 3),
      ]
    );
    const sid = Number(insert.insertId || 0);

    for (let i = 0; i < shuffled.length; i += 1) {
      const snapshot = shuffled[i];
      const standardAnswer = snapshot.standard_answer || {};
      await tx.run(
        `INSERT INTO te_exam_answers
          (session_id, question_id, question_snapshot_json, standard_answer_json, user_answer_json, sort_order)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [
          sid,
          Number(snapshot.question_id || 0),
          JSON.stringify(hideStandardAnswer(snapshot)),
          JSON.stringify(standardAnswer),
          i,
        ]
      );
    }

    return sid;
  });

  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  const answers = await query(
    `SELECT id, question_id, question_snapshot_json, user_answer_json, sort_order
     FROM te_exam_answers
     WHERE session_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [sessionId]
  );

  if (req) {
    await logOperation({
      req,
      action: operationAction,
      entity: 'exam_session',
      entityId: sessionId,
      message: operationMessage || `开始考试会话 ${sessionId}`,
      afterData: operationAfterData || {
        paper_id: Number(paperId || 0),
        attempt_no: Number(attemptNo || 1),
        question_count: answers.length,
        retake_opportunity_id: Number(retakeOpportunityId || 0),
      },
    });
  }

  return {
    session,
    remaining_seconds: Math.max(0, Math.floor(Number(session?.duration_minutes || durationMinutes || 60) * 60)),
    questions: answers.map((item) => ({
      question_id: Number(item.question_id),
      sort_order: Number(item.sort_order || 0),
      snapshot: parseMaybeJson(item.question_snapshot_json, {}),
      user_answer: parseMaybeJson(item.user_answer_json, null),
    })),
  };
};

const loadExamSessionPayload = async ({ sessionId, req = null, autoFinalizeOnExpire = true } = {}) => {
  const sid = Number(sessionId || 0);
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sid]);
  if (!session) throw appError('考试会话不存在', 404);

  if (autoFinalizeOnExpire && trimText(session.status) === 'started' && Date.now() >= getExamSessionExpireTs(session)) {
    await finalizeExamSession({ sessionId: sid, forceTimeout: true, req });
  }

  const latestSession = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sid]);
  const answers = await query(
    `SELECT question_id, question_snapshot_json, user_answer_json, sort_order
     FROM te_exam_answers
     WHERE session_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [sid]
  );

  const remainingSeconds = trimText(latestSession.status) === 'started'
    ? Math.max(0, Math.floor((getExamSessionExpireTs(latestSession) - Date.now()) / 1000))
    : 0;

  return {
    session: latestSession,
    remaining_seconds: remainingSeconds,
    questions: answers.map((item) => ({
      question_id: Number(item.question_id),
      sort_order: Number(item.sort_order || 0),
      snapshot: parseMaybeJson(item.question_snapshot_json, {}),
      user_answer: parseMaybeJson(item.user_answer_json, null),
    })),
  };
};

app.post('/api/train-exam/papers/:id/exam/start', requireReader, examStartRateLimit, asyncHandler(async (req, res) => {
  await activateDueScheduledPapers();
  const paperId = Number(req.params.id);
  ensurePaperReadAccess(req, await getPaperAccessRowById(paperId));
  const paper = await loadPaperDetail(paperId);
  if (!paper) throw appError('试卷不存在', 404);
  if (trimText(paper.status) !== 'published') throw appError('试卷未发布，不能开始考试', 409);

  const userId = Number(req.user.id || 0);
  const runningSession = await get(
    `SELECT * FROM te_exam_sessions
     WHERE paper_id = ? AND user_id = ? AND status = 'started'
     ORDER BY id DESC
     LIMIT 1`,
    [paperId, userId]
  );
  if (runningSession && shouldResumeExistingExamSession({ session: runningSession })) {
    const payload = await loadExamSessionPayload({ sessionId: Number(runningSession.id), req, autoFinalizeOnExpire: true });
    res.status(200).json({
      ...payload,
      resumed: true,
    });
    return;
  }
  if (runningSession) {
    await finalizeExamSession({ sessionId: Number(runningSession.id), forceTimeout: true, req });
  }

  const doneAttemptsRow = await get(
    `SELECT COUNT(1) AS total
     FROM te_exam_sessions
     WHERE paper_id = ? AND user_id = ?`,
    [paperId, userId]
  );
  const doneAttempts = Number(doneAttemptsRow?.total || 0);
  const maxAttempts = Math.max(1, Number(paper.max_attempts || 3));
  const availableRetakeOpportunity = doneAttempts >= maxAttempts
    ? await getAvailableRetakeOpportunity({ userId, paperId })
    : null;
  const startPermission = resolveRetakeStartPermission({
    doneAttempts,
    maxAttempts,
    availableOpportunity: availableRetakeOpportunity,
  });
  if (!startPermission.allowed) {
    throw appError('该试卷已达到最大考试次数', 409);
  }

  const attemptNo = startPermission.attemptNo;
  let snapshots = [];

  if (trimText(paper.paper_mode) === 'fixed') {
    snapshots = (paper.fixed_questions || []).map((item) => ({
      ...item.snapshot,
      points: Number(item.points || item.snapshot?.points || 1),
    }));
  } else {
    snapshots = await buildRandomQuestionsByRules(paper.rules || []);
  }

  if (!snapshots.length) {
    throw appError('试卷没有可用题目，无法开始考试', 409);
  }

  const payload = await createExamSessionWithSnapshots({
    paperId,
    user: req.user,
    attemptNo,
    durationMinutes: Number(paper.duration_minutes || 60),
    passScore: Number(paper.pass_score || 80),
    maxAttempts,
    snapshots,
    req,
    operationAction: 'EXAM_START',
    operationMessage: startPermission.retakeOpportunityId
      ? `使用补考机会开始考试会话，试卷 ${paperId}`
      : '',
    retakeOpportunityId: startPermission.retakeOpportunityId,
  });

  res.status(201).json({
    ...payload,
    resumed: false,
  });
}));

app.get('/api/train-exam/exam-sessions/:sessionId', requireReader, asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  ensureExamSessionAccess(req, session, { allowAuditRead: true });
  const payload = await loadExamSessionPayload({ sessionId, req, autoFinalizeOnExpire: true });
  res.json(payload);
}));

app.post('/api/train-exam/exam-sessions/:sessionId/answers', requireReader, asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  const { isOwner } = ensureExamSessionAccess(req, session, { allowAuditRead: false });
  if (!isOwner) throw appError('仅本人可答题', 403);

  if (trimText(session.status) !== 'started') throw appError('当前会话已结束，不能继续答题', 409);

  const questionId = Number(req.body?.question_id || 0);
  if (!questionId) throw appError('question_id 无效', 400);
  const userAnswer = req.body?.user_answer;

  const existing = await get(
    `SELECT id FROM te_exam_answers WHERE session_id = ? AND question_id = ? LIMIT 1`,
    [sessionId, questionId]
  );
  if (!existing) throw appError('题目不在当前会话中', 404);

  await run(
    `UPDATE te_exam_answers
     SET user_answer_json = ?, updated_at = NOW()
     WHERE id = ?`,
    [JSON.stringify(userAnswer ?? null), Number(existing.id)]
  );

  res.json({ success: true });
}));

app.post('/api/train-exam/exam-sessions/:sessionId/focus-switch', requireReader, asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  ensureExamSessionAccess(req, session, { allowAuditRead: false });
  if (trimText(session.status) !== 'started') throw appError('当前会话已结束', 409);

  await run(
    `UPDATE te_exam_sessions
     SET focus_switch_count = focus_switch_count + 1, updated_at = NOW()
     WHERE id = ?`,
    [sessionId]
  );
  const after = await get('SELECT focus_switch_count FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  res.json({ focus_switch_count: Number(after?.focus_switch_count || 0) });
}));

app.post('/api/train-exam/exam-sessions/:sessionId/submit', requireReader, asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  const { isOwner } = ensureExamSessionAccess(req, session, { allowAuditRead: false });
  if (!isOwner) throw appError('仅本人可交卷', 403);

  const result = await finalizeExamSession({ sessionId, forceTimeout: false, req });
  let advice = null;
  try {
    advice = await generateResultAdvice({
      req,
      resultId: Number(result?.id || 0),
      force: false,
    });
  } catch (err) {
    console.warn('[train-exam] generateResultAdvice failed:', err?.message || err);
  }

  res.json({
    ...normalizeAdminResultRow(result),
    ai_advice: advice
      ? {
          id: Number(advice.id || 0),
          status: trimText(advice.status),
          advice_text: trimText(advice.advice_text),
          model_name: trimText(advice.model_name),
          updated_at: advice.updated_at,
        }
      : null,
  });
}));

app.get('/api/train-exam/exam-sessions/:sessionId/result', requireReader, asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [sessionId]);
  ensureExamSessionAccess(req, session, { allowAuditRead: true });

  let result = await get('SELECT * FROM te_exam_results WHERE session_id = ? LIMIT 1', [sessionId]);
  if (!result && trimText(session.status) === 'started') {
    const started = parseDate(session.started_at);
    const expireTs = started ? started.getTime() + Number(session.duration_minutes || 60) * 60 * 1000 : 0;
    if (Date.now() >= expireTs) {
      result = await finalizeExamSession({ sessionId, forceTimeout: true, req });
    }
  }
  if (!result) throw appError('当前会话尚未生成成绩', 409);

  res.json({
    ...normalizeAdminResultRow(result),
    detail: parseMaybeJson(result.detail_json, {}),
  });
}));

app.get('/api/train-exam/my/results', requireReader, asyncHandler(async (req, res) => {
  const includeRetrain = normalizeBoolean(req.query.include_retrain, false);
  const rows = await query(
    `SELECT * FROM te_exam_results
     WHERE user_id = ? ${includeRetrain ? '' : 'AND paper_id > 0'}
     ORDER BY id DESC`,
    [Number(req.user.id || 0)]
  );
  res.json(rows.map((item) => normalizeAdminResultRow(item)));
}));

app.get('/api/train-exam/admin/results/papers', requireResultCenterReader, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT
      p.id AS paper_id,
      p.name AS paper_name,
      p.status,
      COUNT(r.id) AS result_total,
      COUNT(DISTINCT CASE WHEN r.user_id IS NOT NULL THEN r.user_id END) AS candidate_total,
      SUM(CASE WHEN r.is_final = 1 THEN 1 ELSE 0 END) AS final_result_count,
      SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS pass_count,
      AVG(r.score) AS average_score,
      MAX(r.created_at) AS latest_result_at,
      SUM(CASE WHEN r.total_score > 0 AND (r.score / r.total_score) >= 0.9 THEN 1 ELSE 0 END) AS rating_a_count,
      SUM(CASE WHEN r.total_score > 0 AND (r.score / r.total_score) >= 0.8 AND (r.score / r.total_score) < 0.9 THEN 1 ELSE 0 END) AS rating_b_count,
      SUM(CASE WHEN r.total_score > 0 AND (r.score / r.total_score) >= 0.6 AND (r.score / r.total_score) < 0.8 THEN 1 ELSE 0 END) AS rating_c_count,
      SUM(CASE WHEN r.id IS NOT NULL AND (r.total_score <= 0 OR (r.total_score > 0 AND (r.score / r.total_score) < 0.6)) THEN 1 ELSE 0 END) AS rating_d_count
     FROM te_papers p
     LEFT JOIN te_exam_results r ON r.paper_id = p.id
     WHERE p.status = 'published'
     GROUP BY p.id, p.name, p.status
     ORDER BY latest_result_at DESC, p.id DESC`
  );
  res.json({
    items: rows.map((item) => normalizeAdminResultPaperSummaryRow(item)),
  });
}));

app.get('/api/train-exam/my/results/export.csv', requireReader, asyncHandler(async (req, res) => {
  const includeRetrain = normalizeBoolean(req.query.include_retrain, false);
  const rows = await query(
    `SELECT
      r.*,
      p.name AS paper_name,
      CASE
        WHEN s.started_at IS NOT NULL
          THEN GREATEST(TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.submitted_at, s.ended_at, s.updated_at, r.created_at)), 0)
        ELSE 0
      END AS duration_seconds
     FROM te_exam_results r
     LEFT JOIN te_exam_sessions s ON s.id = r.session_id
     LEFT JOIN te_papers p ON p.id = r.paper_id
     WHERE r.user_id = ? ${includeRetrain ? '' : 'AND r.paper_id > 0'}
     ORDER BY r.created_at DESC, r.id DESC`,
    [Number(req.user.id || 0)]
  );
  const normalizedRows = rows.map((item) => normalizeAdminResultRow(item));
  const csv = buildResultsExportCsv(normalizedRows);
  const fileName = buildResultsExportFilename('train-exam-my-results');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(csv);
}));

app.get('/api/train-exam/admin/results', requireResultCenterReader, asyncHandler(async (req, res) => {
  const filters = normalizeAdminResultsFilters(req.query);
  const { whereSql, params } = buildAdminResultsWhere(filters);
  const offset = Math.max(0, (filters.page - 1) * filters.limit);

  const [totalRow, summaryRow, rows, users, papers] = await Promise.all([
    get(
      `SELECT COUNT(1) AS total
       FROM te_exam_results r
       LEFT JOIN te_papers p ON p.id = r.paper_id
       ${whereSql}`,
      params
    ),
    get(
      `SELECT
        COUNT(1) AS total_results,
        SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS pass_count,
        SUM(CASE WHEN r.passed = 0 THEN 1 ELSE 0 END) AS fail_count,
        AVG(r.score) AS average_score,
        AVG(
          CASE
            WHEN s.started_at IS NOT NULL
              THEN GREATEST(TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.submitted_at, s.ended_at, s.updated_at, r.created_at)), 0)
            ELSE 0
          END
        ) AS average_duration_seconds,
        SUM(CASE WHEN r.is_final = 1 THEN 1 ELSE 0 END) AS final_result_count
       FROM te_exam_results r
       LEFT JOIN te_exam_sessions s ON s.id = r.session_id
       LEFT JOIN te_papers p ON p.id = r.paper_id
       ${whereSql}`,
      params
    ),
    query(
      `SELECT
        r.*,
        p.name AS paper_name,
        CASE
          WHEN s.started_at IS NOT NULL
            THEN GREATEST(TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.submitted_at, s.ended_at, s.updated_at, r.created_at)), 0)
          ELSE 0
        END AS duration_seconds
       FROM te_exam_results r
       LEFT JOIN te_exam_sessions s ON s.id = r.session_id
       LEFT JOIN te_papers p ON p.id = r.paper_id
       ${whereSql}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    ),
    buildAdminResultUserOptions({ whereSql, params }),
    buildAdminResultPaperOptions({ whereSql, params }),
  ]);

  const total = Number(totalRow?.total || 0);
  res.json({
    items: rows.map((item) => normalizeAdminResultRow(item)),
    page: filters.page,
    limit: filters.limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / filters.limit) || 1),
    summary: normalizeAdminResultsSummary(summaryRow || {}),
    filters: {
      applied: filters,
      users,
      papers,
    },
  });
}));

app.post('/api/train-exam/admin/users/:userId/papers/:paperId/retake-opportunities', requireAdminOnly, asyncHandler(async (req, res) => {
  const userId = Number(req.params.userId);
  const paperId = Number(req.params.paperId);
  if (!userId) throw appError('考生不存在', 404);
  if (!paperId) throw appError('试卷不存在', 404);

  const target = await loadRetakeTarget({ userId, paperId });
  const reason = trimText(req.body?.reason || '管理员手动开放补考');
  const opportunity = await grantRetakeOpportunity({
    paperId,
    userId,
    username: target.user.username,
    reason,
    grantedBy: req.user,
  });

  await logOperation({
    req,
    action: 'RESULT_RETAKE_GRANT',
    entity: 'exam_retake_opportunity',
    entityId: opportunity.id,
    message: `为 ${target.user.username} 开放补考机会`,
    afterData: {
      ...opportunity,
      paper_name: target.paper.name,
    },
  });

  res.status(201).json({
    success: true,
    opportunity,
  });
}));

app.delete('/api/train-exam/admin/results/:id', requireAdminOnly, asyncHandler(async (req, res) => {
  const resultId = Number(req.params.id);
  if (!resultId) throw appError('考试成绩不存在', 404);

  const resultRow = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [resultId]);
  if (!resultRow) throw appError('考试成绩不存在', 404);
  const paperId = Number(resultRow.paper_id || 0);
  if (!paperId) throw appError('仅正式试卷成绩可删除并开放补考', 409);
  const paperRow = await get('SELECT id FROM te_papers WHERE id = ? LIMIT 1', [paperId]);
  if (!paperRow) throw appError('试卷不存在，无法开放补考', 409);

  const certRows = await query('SELECT id, file_path FROM te_certificates WHERE result_id = ?', [resultId]);
  const removal = await transaction(async (tx) => {
    const removedAdvices = await tx.run('DELETE FROM te_result_ai_advices WHERE result_id = ?', [resultId]);
    await tx.run('UPDATE te_recertification_jobs SET completed_result_id = NULL WHERE completed_result_id = ?', [resultId]);
    const removedRecertJobs = await tx.run('DELETE FROM te_recertification_jobs WHERE result_id = ?', [resultId]);
    const removedCertificates = await tx.run('DELETE FROM te_certificates WHERE result_id = ?', [resultId]);
    const removedResults = await tx.run('DELETE FROM te_exam_results WHERE id = ?', [resultId]);
    if (Number(removedResults?.affectedRows || 0) <= 0) {
      throw appError('考试成绩不存在', 404);
    }
    if (!shouldKeepFinalResultAfterDelete({ deletedWasFinal: Number(resultRow.is_final || 0) === 1 })) {
      await tx.run(
        `UPDATE te_exam_results
         SET is_final = 0
         WHERE user_id = ? AND paper_id = ?`,
        [Number(resultRow.user_id || 0), Number(resultRow.paper_id || 0)]
      );
    }
    const opportunity = await grantRetakeOpportunity({
      tx,
      paperId,
      userId: Number(resultRow.user_id || 0),
      username: resultRow.username,
      reason: '删除成绩后自动开放补考',
      grantedBy: req.user,
    });
    return {
      opportunity,
      removed_advices: Number(removedAdvices?.affectedRows || 0),
      removed_recert_jobs: Number(removedRecertJobs?.affectedRows || 0),
      removed_certificates: Number(removedCertificates?.affectedRows || 0),
    };
  });

  let removedCertificateFiles = 0;
  for (const row of certRows) {
    const removed = await removeCertificateFileIfExists(row?.file_path);
    if (removed) removedCertificateFiles += 1;
  }

  await logOperation({
    req,
    action: 'RESULT_DELETE',
    entity: 'exam_result',
    entityId: resultId,
    message: `删除考试成绩 ${resultId} 并开放补考机会`,
    beforeData: resultRow,
    afterData: {
      ...removal,
      removed_certificate_files: removedCertificateFiles,
    },
  });

  res.json({
    success: true,
    deleted_result_id: resultId,
    retake_opportunity: removal.opportunity,
    removed_certificate_files: removedCertificateFiles,
  });
}));

app.get('/api/train-exam/admin/results/export.csv', requireResultCenterReader, asyncHandler(async (req, res) => {
  const filters = normalizeAdminResultsFilters(req.query);
  const { whereSql, params } = buildAdminResultsWhere(filters);
  const rows = await query(
    `SELECT
      r.*,
      p.name AS paper_name,
      CASE
        WHEN s.started_at IS NOT NULL
          THEN GREATEST(TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.submitted_at, s.ended_at, s.updated_at, r.created_at)), 0)
        ELSE 0
      END AS duration_seconds
     FROM te_exam_results r
     LEFT JOIN te_exam_sessions s ON s.id = r.session_id
     LEFT JOIN te_papers p ON p.id = r.paper_id
     ${whereSql}
     ORDER BY r.created_at DESC, r.id DESC`,
    params
  );
  const normalizedRows = rows.map((item) => normalizeAdminResultRow(item));
  const csv = buildResultsExportCsv(normalizedRows);
  const fileName = buildResultsExportFilename('train-exam-results');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(csv);
}));

app.get('/api/train-exam/admin/users/:userId/results', requireResultCenterReader, asyncHandler(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) throw appError('考生不存在', 404);

  const filters = normalizeAdminResultsFilters({
    ...req.query,
    user_id: userId,
  });
  const { whereSql, params } = buildAdminResultsWhere(filters);
  const offset = Math.max(0, (filters.page - 1) * filters.limit);

  const [profile, rows, summaryRows, totalRow] = await Promise.all([
    get(
      `SELECT user_id, username, department, position_title
       FROM te_user_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    ),
    query(
      `SELECT
        r.*,
        p.name AS paper_name,
        CASE
          WHEN s.started_at IS NOT NULL
            THEN GREATEST(TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.submitted_at, s.ended_at, s.updated_at, r.created_at)), 0)
          ELSE 0
        END AS duration_seconds
       FROM te_exam_results r
       LEFT JOIN te_exam_sessions s ON s.id = r.session_id
       LEFT JOIN te_papers p ON p.id = r.paper_id
       ${whereSql}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    ),
    query(
      `SELECT r.score, r.passed, r.is_final, r.created_at
       FROM te_exam_results r
       LEFT JOIN te_papers p ON p.id = r.paper_id
       ${whereSql}
       ORDER BY r.created_at DESC, r.id DESC`,
      params
    ),
    get(
      `SELECT COUNT(1) AS total
       FROM te_exam_results r
       LEFT JOIN te_papers p ON p.id = r.paper_id
       ${whereSql}`,
      params
    ),
  ]);

  const candidateRow = rows[0] || {};
  const total = Number(totalRow?.total || 0);
  res.json({
    candidate: {
      user_id: userId,
      username: trimText(profile?.username || candidateRow?.username),
      department: trimText(profile?.department || candidateRow?.user_department),
      position_title: trimText(profile?.position_title || candidateRow?.user_position),
    },
    items: rows.map((item) => normalizeAdminResultRow(item)),
    summary: buildCandidateHistorySummary(summaryRows),
    overall_evaluation: buildOverallEvaluation({ resultRows: summaryRows }),
    page: filters.page,
    limit: filters.limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / filters.limit) || 1),
  });
}));

app.get('/api/train-exam/my/certificates', requireReader, asyncHandler(async (req, res) => {
  await ensureAutoRecertificationJobs({
    userId: Number(req.user.id || 0),
    username: req.user.username,
  });
  const rows = await buildCertificatesWithStatus({ userId: Number(req.user.id || 0) });
  res.json(rows);
}));

app.get('/api/train-exam/my/recertification', requireReader, asyncHandler(async (req, res) => {
  await ensureAutoRecertificationJobs({
    userId: Number(req.user.id || 0),
    username: req.user.username,
  });
  const rows = await query(
    `SELECT
      j.*,
      p.name AS paper_name
     FROM te_recertification_jobs j
     LEFT JOIN te_papers p ON p.id = j.paper_id
     WHERE j.user_id = ?
     ORDER BY j.due_at DESC, j.id DESC`,
    [Number(req.user.id || 0)]
  );
  res.json(rows);
}));

app.post('/api/train-exam/recertification/jobs/:id/start', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const job = await get('SELECT * FROM te_recertification_jobs WHERE id = ? LIMIT 1', [id]);
  if (!job) throw appError('续证任务不存在', 404);
  if (Number(job.user_id || 0) !== Number(req.user.id || 0) && !isAdmin(req) && !isAuditor(req)) {
    throw appError('无权限操作该续证任务', 403);
  }
  if (!['scheduled', 'in_progress'].includes(trimText(job.status).toLowerCase())) {
    throw appError('续证任务状态不可开始', 409);
  }

  const paper = await get('SELECT * FROM te_papers WHERE id = ? LIMIT 1', [Number(job.paper_id || 0)]);
  if (!paper) throw appError('续证目标试卷不存在', 404);
  if (trimText(paper.status) !== 'published') throw appError('续证目标试卷未发布，暂不可复考', 409);

  await run(
    `UPDATE te_recertification_jobs
     SET status = 'in_progress', updated_at = NOW()
     WHERE id = ?`,
    [id]
  );

  res.json({
    id,
    status: 'in_progress',
    paper_id: Number(job.paper_id || 0),
    message: '续证任务已开始，请进入考试中心完成复考。',
  });
}));

app.post('/api/train-exam/retrain/start', requireReader, asyncHandler(async (req, res) => {
  const mode = trimText(req.body?.mode || 'result').toLowerCase();
  if (!['result', 'notebook'].includes(mode)) {
    throw appError('复训模式无效', 400);
  }

  const questionTypeFilterRaw = trimText(req.body?.question_type || req.body?.filter_question_type).toLowerCase();
  const questionTypeFilter = questionTypeFilterRaw && questionTypeFilterRaw !== 'all'
    ? normalizeQuestionType(questionTypeFilterRaw, '')
    : '';
  if (questionTypeFilterRaw && !questionTypeFilter) {
    throw appError('题型筛选无效', 400);
  }
  const questionCategoryFilterRaw = trimText(req.body?.question_category || req.body?.filter_question_category);
  const questionCategoryFilter = questionCategoryFilterRaw && questionCategoryFilterRaw.toLowerCase() !== 'all'
    ? normalizeQuestionCategory(questionCategoryFilterRaw, '未分类')
    : '';
  const questionCategoryCache = new Map();
  const resolveQuestionCategory = async (questionId) => {
    const qid = Number(questionId || 0);
    if (!qid) return '';
    if (questionCategoryCache.has(qid)) return questionCategoryCache.get(qid);
    const row = await get('SELECT question_category FROM te_question_bank WHERE id = ? LIMIT 1', [qid]);
    const category = trimText(row?.question_category)
      ? normalizeQuestionCategory(row.question_category, '未分类')
      : '';
    questionCategoryCache.set(qid, category);
    return category;
  };
  const isSnapshotMatched = (snapshot = {}) => {
    if (questionTypeFilter) {
      const qType = normalizeQuestionType(snapshot.question_type, '');
      if (qType !== questionTypeFilter) return false;
    }
    if (questionCategoryFilter) {
      const category = normalizeQuestionCategory(snapshot.question_category || snapshot.category || '未分类', '未分类');
      if (category !== questionCategoryFilter) return false;
    }
    return true;
  };

  const userId = Number(req.user.id || 0);
  if (!userId) throw appError('用户身份无效', 401);

  let sourceResultId = 0;
  let sourcePaperId = 0;
  let notebookQuestionIds = [];
  const snapshots = [];
  const insertedQids = new Set();

  if (mode === 'result') {
    const resultId = Number(req.body?.result_id || 0);
    if (!resultId) throw appError('请先选择历史考试成绩', 400);
    const resultRow = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [resultId]);
    ensureResultAccess(req, resultRow, { allowAuditRead: false });
    sourceResultId = resultId;
    sourcePaperId = Number(resultRow?.paper_id || 0);

    const wrongRows = await query(
      `SELECT question_id, question_snapshot_json, standard_answer_json, sort_order
       FROM te_exam_answers
       WHERE session_id = ? AND IFNULL(is_correct, 0) = 0
       ORDER BY sort_order ASC, id ASC`,
      [Number(resultRow.session_id || 0)]
    );

    for (const row of wrongRows) {
      const normalized = normalizeSnapshotForSession({
        snapshot: parseMaybeJson(row.question_snapshot_json, {}),
        standardAnswer: parseMaybeJson(row.standard_answer_json, {}),
        fallbackQuestionId: Number(row.question_id || 0),
      });
      if (!normalized) continue;
      if (questionCategoryFilter && !trimText(normalized.question_category)) {
        normalized.question_category = await resolveQuestionCategory(normalized.question_id);
      }
      if (!isSnapshotMatched(normalized)) continue;
      const qid = Number(normalized.question_id || 0);
      if (!qid || insertedQids.has(qid)) continue;
      insertedQids.add(qid);
      snapshots.push(normalized);
    }
  } else {
    const selectAll = normalizeBoolean(req.body?.select_all, false);
    const requestedQuestionIds = selectAll ? [] : parseIdArray(req.body?.question_ids || req.body?.ids);
    if (!selectAll && !requestedQuestionIds.length) throw appError('请先选择错题本题目', 400);

    const notebook = await buildWrongQuestionNotebook({
      userId,
      page: 1,
      limit: 10000,
      historyScanLimit: 10000,
    });
    const notebookAllIds = (Array.isArray(notebook.all_items) ? notebook.all_items : [])
      .map((item) => Number(item?.question_id || 0))
      .filter((id) => id > 0);
    if (selectAll) {
      notebookQuestionIds = notebookAllIds;
    } else {
      const notebookQuestionIdSet = new Set(notebookAllIds);
      notebookQuestionIds = requestedQuestionIds.filter((id) => notebookQuestionIdSet.has(id));
    }
    if (!notebookQuestionIds.length) throw appError('所选题目不在错题本中，无法启动复训', 409);

    const marks = notebookQuestionIds.map(() => '?').join(',');
    const wrongRows = await query(
      `SELECT ea.question_id, ea.question_snapshot_json, ea.standard_answer_json, ea.updated_at, ea.id
       FROM te_exam_answers ea
       INNER JOIN te_exam_sessions s ON s.id = ea.session_id
       WHERE s.user_id = ?
         AND s.status IN ('submitted', 'timeout')
         AND IFNULL(ea.is_correct, 0) = 0
         AND ea.question_id IN (${marks})
       ORDER BY ea.updated_at DESC, ea.id DESC`,
      [userId, ...notebookQuestionIds]
    );

    const latestWrongByQuestionId = new Map();
    for (const row of wrongRows) {
      const qid = Number(row.question_id || 0);
      if (!qid || latestWrongByQuestionId.has(qid)) continue;
      latestWrongByQuestionId.set(qid, row);
    }

    for (const questionId of notebookQuestionIds) {
      const row = latestWrongByQuestionId.get(questionId);
      if (!row) continue;
      const normalized = normalizeSnapshotForSession({
        snapshot: parseMaybeJson(row.question_snapshot_json, {}),
        standardAnswer: parseMaybeJson(row.standard_answer_json, {}),
        fallbackQuestionId: Number(row.question_id || 0),
      });
      if (!normalized) continue;
      if (questionCategoryFilter && !trimText(normalized.question_category)) {
        normalized.question_category = await resolveQuestionCategory(normalized.question_id);
      }
      if (!isSnapshotMatched(normalized)) continue;
      const qid = Number(normalized.question_id || 0);
      if (!qid || insertedQids.has(qid)) continue;
      insertedQids.add(qid);
      snapshots.push(normalized);
    }
  }

  if (!snapshots.length) {
    const scopedText = questionTypeFilter || questionCategoryFilter ? '（当前筛选条件下）' : '';
    if (mode === 'notebook') throw appError(`错题本${scopedText}暂无可复训题目`, 409);
    throw appError(`该历史考试${scopedText}暂无可复训错题`, 409);
  }

  const retrainCountRow = await get(
    `SELECT COUNT(1) AS total
     FROM te_exam_sessions
     WHERE user_id = ? AND paper_id = 0`,
    [userId]
  );
  const attemptNo = Number(retrainCountRow?.total || 0) + 1;
  const totalPoints = snapshots.reduce((sum, item) => sum + Math.max(0, Number(item.points || 0)), 0);
  const durationMinutes = Math.max(10, Math.min(120, Math.ceil(snapshots.length * 2)));
  const passScore = Number((totalPoints * 0.8).toFixed(2));

  const payload = await createExamSessionWithSnapshots({
    paperId: 0,
    user: req.user,
    attemptNo,
    durationMinutes,
    passScore,
    maxAttempts: 9999,
    snapshots,
    req,
    operationAction: 'RETRAIN_START',
    operationMessage: mode === 'notebook'
      ? `开始错题本复训，会话 ${attemptNo}`
      : `开始历史考试错题复训，会话 ${attemptNo}`,
    operationAfterData: {
      mode,
      filter_question_type: questionTypeFilter || null,
      filter_question_category: questionCategoryFilter || null,
      source_result_id: sourceResultId || null,
      source_paper_id: sourcePaperId || null,
      selected_question_ids: mode === 'notebook' ? notebookQuestionIds : null,
      select_all: mode === 'notebook' ? normalizeBoolean(req.body?.select_all, false) : null,
      question_count: snapshots.length,
      attempt_no: attemptNo,
    },
  });

  res.status(201).json({
    ...payload,
    mode,
    filter_question_type: questionTypeFilter || null,
    filter_question_category: questionCategoryFilter || null,
    source_result_id: sourceResultId || null,
    source_paper_id: sourcePaperId || null,
    selected_question_ids: mode === 'notebook' ? notebookQuestionIds : null,
    select_all: mode === 'notebook' ? normalizeBoolean(req.body?.select_all, false) : null,
    message: mode === 'notebook' ? '已按错题本启动复训' : '已按历史考试启动错题复训',
  });
}));

app.get('/api/train-exam/my/wrong-questions', requireReader, asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 20);
  const notebook = await buildWrongQuestionNotebook({
    userId: Number(req.user.id || 0),
    page,
    limit,
    historyScanLimit: 8000,
  });

  res.json({
    items: notebook.items,
    summary: notebook.summary,
    pagination: notebook.pagination,
  });
}));

app.get('/api/train-exam/my/retrain-recommendations', requireReader, asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(10, toPositiveInt(req.query.limit, 6)));
  const payload = await buildRetrainRecommendations({
    userId: Number(req.user.id || 0),
    limit,
  });
  res.json(payload);
}));

app.get('/api/train-exam/results/:id', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [id]);
  ensureResultAccess(req, row, { allowAuditRead: true });
  const advice = await get('SELECT * FROM te_result_ai_advices WHERE result_id = ? LIMIT 1', [id]);

  res.json({
    ...normalizeAdminResultRow(row),
    detail: parseMaybeJson(row.detail_json, {}),
    ai_advice: advice
      ? {
          id: Number(advice.id || 0),
          status: trimText(advice.status),
          advice_text: trimText(advice.advice_text),
          model_name: trimText(advice.model_name),
          error_message: trimText(advice.error_message),
          updated_at: advice.updated_at,
        }
      : null,
  });
}));

app.get('/api/train-exam/results/:id/review-detail', requireReader, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const resultRow = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [id]);
  ensureResultAccess(req, resultRow, { allowAuditRead: true });

  const resultDetail = parseMaybeJson(resultRow?.detail_json, {});
  const [sessionRow, paperRow, answerRows, aiAdviceRow] = await Promise.all([
    get('SELECT * FROM te_exam_sessions WHERE id = ? LIMIT 1', [Number(resultRow?.session_id || 0)]),
    Number(resultRow?.paper_id || 0) > 0
      ? get('SELECT id, name, pass_score FROM te_papers WHERE id = ? LIMIT 1', [Number(resultRow.paper_id || 0)])
      : Promise.resolve(null),
    query(
      `SELECT question_id, sort_order, is_correct, earned_score, question_snapshot_json, user_answer_json, standard_answer_json
       FROM te_exam_answers
       WHERE session_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [Number(resultRow?.session_id || 0)]
    ),
    get('SELECT * FROM te_result_ai_advices WHERE result_id = ? LIMIT 1', [id]),
  ]);

  const payload = buildResultReviewDetail({
    resultRow,
    sessionRow,
    paperRow: {
      id: Number(paperRow?.id || resultRow?.paper_id || 0),
      name: resolveResultPaperName({
        paper_id: resultRow?.paper_id,
        paper_name: paperRow?.name,
      }),
      pass_score: paperRow?.pass_score ?? resultDetail?.pass_score ?? 0,
    },
    answerRows,
    aiAdviceRow,
  });

  res.json(payload);
}));

app.get('/api/train-exam/results/:id/advice', requireReader, asyncHandler(async (req, res) => {
  const resultId = Number(req.params.id);
  const result = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [resultId]);
  ensureResultAccess(req, result, { allowAuditRead: true });

  const row = await get('SELECT * FROM te_result_ai_advices WHERE result_id = ? LIMIT 1', [resultId]);
  if (!row) return res.json(null);

  res.json({
    ...row,
    advice_json: parseMaybeJson(row.advice_json, null),
    source_detail: parseMaybeJson(row.source_detail_json, {}),
  });
}));

app.post('/api/train-exam/results/:id/advice/generate', requireReader, resultAdviceRateLimit, asyncHandler(async (req, res) => {
  const resultId = Number(req.params.id);
  const force = normalizeBoolean(req.body?.force, false);
  const row = await generateResultAdvice({ req, resultId, force });
  res.json({
    ...row,
    advice_json: parseMaybeJson(row.advice_json, null),
    source_detail: parseMaybeJson(row.source_detail_json, {}),
  });
}));

const buildCertificateNo = (resultId) => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `CERT-${datePart}-${resultId}`;
};

const resolveCertificateFonts = async (pdfDoc) => {
  let supportsChinese = false;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const fontkit = require('@pdf-lib/fontkit');
    pdfDoc.registerFontkit(fontkit);
    const candidates = [
      trimText(process.env.CERT_FONT_PATH),
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/Library/Fonts/Arial Unicode.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    ].filter(Boolean);

    for (const fontPath of candidates) {
      try {
        if (!fs.existsSync(fontPath)) continue;
        const bytes = await fs.promises.readFile(fontPath);
        const normal = await pdfDoc.embedFont(bytes, { subset: true });
        return { normal, bold: normal, supportsChinese: true };
      } catch {
        // try next candidate
      }
    }
  } catch {
    supportsChinese = false;
  }

  const normal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  return { normal, bold, supportsChinese };
};

const toPdfSafeLatinText = (value, fallback = '') => {
  const text = trimText(value, fallback);
  if (!text) return fallback;
  const normalized = String(text).normalize('NFKC');
  const safe = normalized.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return safe || fallback;
};

const fitTextByWidth = ({ font, text, size, maxWidth }) => {
  const safeText = String(text || '').trim();
  if (!safeText) return '';
  if (!font || !size || !maxWidth) return safeText;
  if (font.widthOfTextAtSize(safeText, size) <= maxWidth) return safeText;
  const ellipsis = '...';
  let output = safeText;
  while (output.length > 0) {
    const next = `${output}${ellipsis}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) return next;
    output = output.slice(0, -1);
  }
  return ellipsis;
};

const drawCenteredText = ({
  page,
  text,
  y,
  size,
  font,
  color = rgb(0, 0, 0),
  minX = 24,
}) => {
  const safeText = String(text || '');
  const pageWidth = Number(page.getWidth() || 0);
  const textWidth = Number(font?.widthOfTextAtSize ? font.widthOfTextAtSize(safeText, size) : 0);
  const x = Math.max(minX, (pageWidth - textWidth) / 2);
  page.drawText(safeText, {
    x,
    y,
    size,
    font,
    color,
  });
};

const drawCertificateDefaultBackground = (page) => {
  const width = Number(page.getWidth() || 842);
  const height = Number(page.getHeight() || 595);

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(0.96, 0.975, 1),
  });
  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.74, 0.82, 0.93),
    borderWidth: 1.5,
  });
  page.drawRectangle({
    x: 20,
    y: height - 66,
    width: width - 40,
    height: 46,
    color: rgb(0.11, 0.39, 0.86),
  });
};

const drawCertificateTemplateBackground = async ({ pdfDoc, page }) => {
  const template = await resolveRuntimeCertificateTemplate();
  if (!template?.exists || !trimText(template.path)) return false;
  const ext = path.extname(template.path).toLowerCase();
  const bytes = await fs.promises.readFile(template.path);
  let image = null;
  if (ext === '.png') image = await pdfDoc.embedPng(bytes);
  if (ext === '.jpg' || ext === '.jpeg') image = await pdfDoc.embedJpg(bytes);
  if (!image) return false;

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });
  return true;
};

const generateCertificatePdf = async ({ username, paperName, score, passScore, certificateNo }) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]);
  const fonts = await resolveCertificateFonts(pdfDoc);
  const font = fonts.normal;
  const fontBold = fonts.bold;
  const useChinese = !!fonts.supportsChinese;
  const sep = useChinese ? '：' : ':';
  const displayUsername = useChinese
    ? (username || '未命名学员')
    : toPdfSafeLatinText(username, 'Unknown User');
  const displayPaperName = useChinese
    ? (paperName || '培训考试')
    : toPdfSafeLatinText(paperName, 'Training Exam');
  const pageWidth = Number(page.getWidth() || 842);
  const maxLineWidth = Math.max(240, pageWidth - 120);

  const templateApplied = await drawCertificateTemplateBackground({ pdfDoc, page }).catch(() => false);
  if (!templateApplied) {
    drawCertificateDefaultBackground(page);
  }

  const titleText = useChinese ? '聚信培训考试证书' : 'Juxin Training Certificate';
  const subTitleText = useChinese ? '兹证明' : 'This certifies that';
  const passedText = useChinese ? '已通过培训考试并满足发证要求。' : 'has passed the training exam successfully.';
  const examLine = fitTextByWidth({
    font,
    text: `${useChinese ? '试卷' : 'Exam'}${sep}${displayPaperName}`,
    size: 14,
    maxWidth: maxLineWidth,
  });
  const scoreLine = fitTextByWidth({
    font,
    text: useChinese
      ? `成绩${sep}${Number(score || 0).toFixed(2)} / 及格线${sep}${Number(passScore || 0).toFixed(2)}`
      : `Score${sep}${Number(score || 0).toFixed(2)} / Pass Score${sep}${Number(passScore || 0).toFixed(2)}`,
    size: 14,
    maxWidth: maxLineWidth,
  });
  const certNoLine = fitTextByWidth({
    font,
    text: `${useChinese ? '证书编号' : 'Certificate No'}${sep}${certificateNo}`,
    size: 14,
    maxWidth: maxLineWidth,
  });
  const issueAtLine = fitTextByWidth({
    font,
    text: `${useChinese ? '签发时间' : 'Issued At'}${sep}${toMysqlDatetime(new Date())}`,
    size: 14,
    maxWidth: maxLineWidth,
  });

  drawCenteredText({
    page,
    text: titleText,
    y: 506,
    size: 28,
    font: fontBold,
    color: templateApplied ? rgb(0.08, 0.16, 0.33) : rgb(1, 1, 1),
  });
  drawCenteredText({
    page,
    text: subTitleText,
    y: 442,
    size: 16,
    font,
    color: rgb(0.14, 0.2, 0.34),
  });
  drawCenteredText({
    page,
    text: fitTextByWidth({ font: fontBold, text: displayUsername, size: 30, maxWidth: maxLineWidth }),
    y: 398,
    size: 30,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  drawCenteredText({
    page,
    text: passedText,
    y: 354,
    size: 15,
    font,
    color: rgb(0.17, 0.26, 0.42),
  });

  page.drawLine({
    start: { x: 160, y: 344 },
    end: { x: pageWidth - 160, y: 344 },
    thickness: 1,
    color: rgb(0.8, 0.86, 0.94),
  });

  drawCenteredText({ page, text: examLine, y: 288, size: 14, font, color: rgb(0.15, 0.19, 0.29) });
  drawCenteredText({ page, text: scoreLine, y: 258, size: 14, font, color: rgb(0.15, 0.19, 0.29) });
  drawCenteredText({ page, text: certNoLine, y: 228, size: 14, font, color: rgb(0.15, 0.19, 0.29) });
  drawCenteredText({ page, text: issueAtLine, y: 198, size: 14, font, color: rgb(0.15, 0.19, 0.29) });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
};

const buildCertificateTemplatePayload = (template) => {
  if (!template?.exists) {
    return {
      exists: false,
      source: trimText(template?.source || 'none') || 'none',
      can_delete: false,
      file_name: '',
      ext: '',
      size_bytes: 0,
      updated_at: null,
      preview_url: '',
    };
  }
  const version = encodeURIComponent(String(template.updatedAt || Date.now()));
  return {
    exists: true,
    source: trimText(template.source),
    can_delete: !!template.canDelete,
    file_name: trimText(template.fileName),
    ext: trimText(template.ext),
    size_bytes: Number(template.sizeBytes || 0),
    updated_at: template.updatedAt || null,
    preview_url: `/api/train-exam/certificate-template/preview?v=${version}`,
  };
};

app.get('/api/train-exam/certificate-template', requireReader, asyncHandler(async (_req, res) => {
  const template = await resolveRuntimeCertificateTemplate();
  res.json(buildCertificateTemplatePayload(template));
}));

app.get('/api/train-exam/certificate-template/preview', requireReader, asyncHandler(async (_req, res) => {
  const template = await resolveRuntimeCertificateTemplate();
  if (!template?.exists || !trimText(template.path)) throw appError('证书模板不存在', 404);
  const filePath = trimText(template.path);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw appError('证书模板文件不存在', 404);

  const ext = trimText(template.ext).toLowerCase();
  if (ext === '.png') res.type('image/png');
  else res.type('image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
}));

app.post('/api/train-exam/certificate-template/upload', requireContentWriter, uploadLimited.single('file'), asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw appError('请选择模板图片文件', 400);
  const ext = path.extname(trimText(file.originalname)).toLowerCase();
  const mimeType = trimText(file.mimetype).toLowerCase();
  if (!ALLOWED_CERT_TEMPLATE_EXTS.has(ext)) {
    throw appError('证书模板仅支持 png/jpg/jpeg', 400);
  }
  if (mimeType && !ALLOWED_CERT_TEMPLATE_MIME.has(mimeType)) {
    throw appError('证书模板格式不正确，请上传 png/jpg/jpeg', 400);
  }

  const oldFiles = await listUploadedCertificateTemplateFiles();
  const targetPath = path.join(CERT_TEMPLATE_DIR, `certificate-template${ext}`);
  await fs.promises.writeFile(targetPath, file.buffer);
  let removedOldFiles = 0;
  for (const item of oldFiles) {
    if (path.resolve(item.path) === path.resolve(targetPath)) continue;
    const removed = await removeCertificateFileIfExists(item.path);
    if (removed) removedOldFiles += 1;
  }

  const template = await resolveRuntimeCertificateTemplate();
  const payload = buildCertificateTemplatePayload(template);

  await logOperation({
    req,
    action: 'CERT_TEMPLATE_UPLOAD',
    entity: 'certificate_template',
    entityId: null,
    message: `上传证书模板 ${trimText(file.originalname)}`,
    afterData: {
      ...payload,
      removed_old_files: removedOldFiles,
    },
  });

  res.status(201).json(payload);
}));

app.delete('/api/train-exam/certificate-template', requireContentWriter, asyncHandler(async (req, res) => {
  const uploadedFiles = await listUploadedCertificateTemplateFiles();
  let removedCount = 0;
  for (const file of uploadedFiles) {
    const removed = await removeCertificateFileIfExists(file.path);
    if (removed) removedCount += 1;
  }

  const template = await resolveRuntimeCertificateTemplate();
  const payload = buildCertificateTemplatePayload(template);

  await logOperation({
    req,
    action: 'CERT_TEMPLATE_DELETE',
    entity: 'certificate_template',
    entityId: null,
    message: `删除证书模板（已移除 ${removedCount} 个文件）`,
    afterData: {
      removed_count: removedCount,
      current: payload,
    },
  });

  res.json({
    success: true,
    removed_count: removedCount,
    current: payload,
  });
}));

app.post('/api/train-exam/results/:id/certificate/generate', requireReader, certificateGenerateRateLimit, asyncHandler(async (req, res) => {
  const resultId = Number(req.params.id);
  const result = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [resultId]);
  ensureResultAccess(req, result, { allowAuditRead: true });

  if (Number(result.passed || 0) !== 1) throw appError('未通过考试，不能生成证书', 409);

  const existing = await get('SELECT * FROM te_certificates WHERE result_id = ? LIMIT 1', [resultId]);
  if (existing) {
    const rows = await buildCertificatesWithStatus({ userId: Number(result.user_id || 0) });
    const same = rows.find((item) => Number(item.result_id || 0) === resultId);
    return res.json(same || existing);
  }

  const paper = await get('SELECT * FROM te_papers WHERE id = ? LIMIT 1', [Number(result.paper_id)]);
  const certificateNo = buildCertificateNo(resultId);
  const pdfBuffer = await generateCertificatePdf({
    username: trimText(result.username),
    paperName: trimText(paper?.name || 'Training Exam'),
    score: Number(result.score || 0),
    passScore: Number(paper?.pass_score || 80),
    certificateNo,
  });

  const fileName = `${certificateNo}.pdf`;
  const filePath = path.join(CERT_ROOT, fileName);
  await fs.promises.writeFile(filePath, pdfBuffer);
  const validity = resolveCertificateValidity({
    issuedAt: toMysqlDatetime(new Date()),
    validFrom: null,
    validUntil: null,
    validityDays: CERT_VALIDITY_DAYS_DEFAULT,
  });
  const remindDays = CERT_RENEWAL_REMIND_DAYS_DEFAULT;

  const insert = await run(
    `INSERT INTO te_certificates
      (result_id, certificate_no, file_path, status, valid_from, valid_until, validity_days, renewal_remind_days, issued_at, created_by_id, created_by_name)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NOW(), ?, ?)`,
    [
      resultId,
      certificateNo,
      filePath,
      validity.valid_from,
      validity.valid_until,
      validity.effective_days,
      remindDays,
      Number(req.user.id) || null,
      req.user.username,
    ]
  );

  const certId = Number(insert.insertId || 0);
  const cert = await get('SELECT * FROM te_certificates WHERE id = ? LIMIT 1', [certId]);

  await logOperation({
    req,
    action: 'CERTIFICATE_GENERATE',
    entity: 'certificate',
    entityId: certId,
    message: `生成证书 ${certificateNo}`,
    afterData: cert,
  });

  res.status(201).json(cert);
}));

app.get('/api/train-exam/results/:id/certificate/download', requireReader, asyncHandler(async (req, res) => {
  const resultId = Number(req.params.id);
  const result = await get('SELECT * FROM te_exam_results WHERE id = ? LIMIT 1', [resultId]);
  ensureResultAccess(req, result, { allowAuditRead: true });

  const cert = await get('SELECT * FROM te_certificates WHERE result_id = ? LIMIT 1', [resultId]);
  if (!cert) throw appError('证书不存在，请先生成', 404);

  const filePath = trimText(cert.file_path);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw appError('证书文件不存在', 404);

  res.download(filePath, `${cert.certificate_no || 'certificate'}.pdf`);
}));

app.get('/api/train-exam/stats/overview', requireReader, asyncHandler(async (_req, res) => {
  await activateDueScheduledPapers();
  const [courseRow, questionRow, paperRow, examRow, passRow] = await Promise.all([
    get('SELECT COUNT(1) AS total FROM te_courses'),
    get(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published_total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_total
       FROM te_question_bank`
    ),
    get(
      `SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published_total
       FROM te_papers`
    ),
    get('SELECT COUNT(1) AS total FROM te_exam_results WHERE paper_id > 0'),
    get(
      `SELECT
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed_total,
        COUNT(1) AS total
       FROM te_exam_results
       WHERE is_final = 1 AND paper_id > 0`
    ),
  ]);

  const passedTotal = Number(passRow?.passed_total || 0);
  const finalTotal = Number(passRow?.total || 0);
  const passRate = finalTotal > 0 ? Number(((passedTotal / finalTotal) * 100).toFixed(2)) : 0;

  res.json({
    course_total: Number(courseRow?.total || 0),
    question_total: Number(questionRow?.total || 0),
    question_published_total: Number(questionRow?.published_total || 0),
    question_draft_total: Number(questionRow?.draft_total || 0),
    paper_total: Number(paperRow?.total || 0),
    paper_published_total: Number(paperRow?.published_total || 0),
    exam_total: Number(examRow?.total || 0),
    final_result_total: finalTotal,
    final_passed_total: passedTotal,
    pass_rate: passRate,
  });
}));

app.get('/api/train-exam/stats/pass-trend', requireReader, asyncHandler(async (req, res) => {
  const days = Math.max(3, Math.min(60, Number(req.query.days || 14)));
  const rows = await query(
    `SELECT
      DATE(created_at) AS day,
      COUNT(1) AS total,
      SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed_total
     FROM te_exam_results
     WHERE is_final = 1 AND paper_id > 0 AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [days]
  );

  const items = rows.map((item) => {
    const total = Number(item.total || 0);
    const passed = Number(item.passed_total || 0);
    return {
      day: item.day,
      total,
      passed_total: passed,
      pass_rate: total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0,
    };
  });

  res.json(items);
}));

app.get('/api/train-exam/stats/org-breakdown', requireAuditorReader, asyncHandler(async (req, res) => {
  const groupBy = trimText(req.query.group_by || 'department').toLowerCase();
  const allowFinalOnly = normalizeBoolean(req.query.final_only, true);

  let groupExpr = 'IFNULL(NULLIF(user_department, \'\'), \'未分配\')';
  if (groupBy === 'position') {
    groupExpr = 'IFNULL(NULLIF(user_position, \'\'), \'未分配\')';
  } else if (groupBy === 'department_position') {
    groupExpr = 'CONCAT(IFNULL(NULLIF(user_department, \'\'), \'未分配\'), \' / \', IFNULL(NULLIF(user_position, \'\'), \'未分配\'))';
  }

  const whereSql = allowFinalOnly ? 'WHERE paper_id > 0 AND is_final = 1' : 'WHERE paper_id > 0';
  const rows = await query(
    `SELECT
      ${groupExpr} AS group_key,
      COUNT(1) AS result_total,
      SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed_total,
      AVG(score) AS avg_score,
      AVG(CASE WHEN attempt_no > 1 THEN attempt_no - 1 ELSE 0 END) AS avg_retake_count,
      SUM(CASE WHEN attempt_no > 1 THEN 1 ELSE 0 END) AS retake_result_total
     FROM te_exam_results
     ${whereSql}
     GROUP BY ${groupExpr}
     ORDER BY result_total DESC, group_key ASC`
  );

  const items = rows.map((item) => {
    const total = Number(item.result_total || 0);
    const passed = Number(item.passed_total || 0);
    return {
      group_key: trimText(item.group_key, '未分配'),
      result_total: total,
      passed_total: passed,
      pass_rate: total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0,
      avg_score: Number(Number(item.avg_score || 0).toFixed(2)),
      avg_retake_count: Number(Number(item.avg_retake_count || 0).toFixed(2)),
      retake_result_total: Number(item.retake_result_total || 0),
    };
  });

  res.json({
    group_by: groupBy,
    final_only: allowFinalOnly,
    items,
  });
}));

app.get('/api/train-exam/audit/logs', requireAuditorReader, asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 200)));
  const action = trimText(req.query.action);
  const username = trimText(req.query.username);
  const entity = trimText(req.query.entity);

  const where = [];
  const params = [];
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  if (entity) {
    where.push('entity = ?');
    params.push(entity);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT * FROM te_operation_logs ${whereSql} ORDER BY id DESC LIMIT ?`,
    [...params, limit]
  );

  res.json(rows);
}));

app.get('/api/train-exam/ai/logs', requireAuditorReader, asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 200)));
  const taskType = trimText(req.query.task_type);
  const status = trimText(req.query.status).toUpperCase();

  const where = [];
  const params = [];
  if (taskType) {
    where.push('task_type = ?');
    params.push(taskType);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT * FROM te_ai_task_logs ${whereSql} ORDER BY id DESC LIMIT ?`,
    [...params, limit]
  );
  res.json(rows);
}));

app.get('/api/train-exam/ai/models', requireAiModelReader, asyncHandler(async (_req, res) => {
  const rows = await query('SELECT id, model_key, name, base_url, model_name, timeout_ms, max_tokens, temperature_default, is_enabled, is_default, created_at, updated_at, api_key FROM te_ai_models ORDER BY id ASC');
  res.json(rows.map((item) => ({ ...item, api_key: maskSecret(item.api_key) })));
}));

app.post('/api/train-exam/ai/models/test', requireAdminOnly, aiModelTestRateLimit, asyncHandler(async (req, res) => {
  const baseUrlInput = trimText(req.body?.base_url);
  const modelDraft = {
    id: null,
    model_key: trimText(req.body?.model_key).toLowerCase(),
    name: trimText(req.body?.name) || '未保存模型',
    base_url: baseUrlInput,
    model_name: trimText(req.body?.model_name),
    api_key: trimText(req.body?.api_key),
    timeout_ms: Math.max(3000, Math.min(120000, Number(req.body?.timeout_ms || 20000))),
  };
  if (!modelDraft.base_url) throw appError('请先填写接口地址（Base URL）', 400);
  if (!modelDraft.model_name) throw appError('请先填写模型名', 400);
  if (!modelDraft.api_key) throw appError('请先填写API Key', 400);
  modelDraft.base_url = normalizeAiBaseUrlOrThrow(modelDraft.base_url);

  const testResult = await testAiModelConnectivity({ model: modelDraft, req });
  await logOperation({
    req,
    action: 'AI_MODEL_TEST',
    entity: 'ai_model',
    entityId: null,
    message: `测试新增模型配置 ${trimText(modelDraft.name || modelDraft.model_key || modelDraft.model_name)}`,
    afterData: {
      model_key: trimText(modelDraft.model_key),
      model_name: trimText(modelDraft.model_name),
      status: trimText(testResult.status),
      available: !!testResult.available,
      latency_ms: Number(testResult.latency_ms || 0),
      error_message: trimText(testResult.error_message),
    },
  });

  res.json({
    model_id: null,
    model_key: trimText(modelDraft.model_key),
    model_name: trimText(modelDraft.model_name),
    ...testResult,
  });
}));

app.post('/api/train-exam/ai/models/:id/test', requireAdminOnly, aiModelTestRateLimit, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw appError('模型ID无效', 400);
  const row = await get('SELECT * FROM te_ai_models WHERE id = ? LIMIT 1', [id]);
  if (!row) throw appError('模型不存在', 404);

  const testResult = await testAiModelConnectivity({ model: row, req });
  await logOperation({
    req,
    action: 'AI_MODEL_TEST',
    entity: 'ai_model',
    entityId: id,
    message: `测试模型可用性 ${trimText(row.name || row.model_key || `#${id}`)}`,
    afterData: {
      model_id: id,
      model_key: trimText(row.model_key),
      status: trimText(testResult.status),
      available: !!testResult.available,
      latency_ms: Number(testResult.latency_ms || 0),
      error_message: trimText(testResult.error_message),
    },
  });

  res.json({
    model_id: id,
    model_key: trimText(row.model_key),
    model_name: trimText(row.model_name),
    ...testResult,
  });
}));

app.post('/api/train-exam/ai/models', requireAdminOnly, asyncHandler(async (req, res) => {
  const modelKey = trimText(req.body?.model_key).toLowerCase();
  const name = trimText(req.body?.name);
  const baseUrlInput = trimText(req.body?.base_url);
  const modelName = trimText(req.body?.model_name);
  const apiKey = trimText(req.body?.api_key);
  const timeoutMs = Math.max(3000, Math.min(120000, Number(req.body?.timeout_ms || 20000)));
  const maxTokens = Math.max(256, Math.min(16000, Number(req.body?.max_tokens || 2048)));
  const temperature = Number.isFinite(Number(req.body?.temperature_default)) ? Number(req.body.temperature_default) : 0.3;
  const isEnabled = normalizeBoolean(req.body?.is_enabled, true) ? 1 : 0;
  const isDefault = normalizeBoolean(req.body?.is_default, false) ? 1 : 0;

  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(modelKey)) {
    throw appError('model_key 仅支持小写字母/数字/下划线/中划线，长度2-64', 400);
  }
  if (!name) throw appError('name 不能为空', 400);
  if (!baseUrlInput) throw appError('base_url 不能为空', 400);
  if (!modelName) throw appError('model_name 不能为空', 400);
  const baseUrl = normalizeAiBaseUrlOrThrow(baseUrlInput);

  const existed = await get('SELECT id FROM te_ai_models WHERE model_key = ? LIMIT 1', [modelKey]);
  if (existed) throw appError('model_key 已存在', 409);

  const insertedId = await transaction(async (tx) => {
    if (isDefault === 1) {
      await tx.run('UPDATE te_ai_models SET is_default = 0');
    }
    const inserted = await tx.run(
      `INSERT INTO te_ai_models
        (model_key, name, base_url, model_name, api_key, timeout_ms, max_tokens, temperature_default, is_enabled, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [modelKey, name, baseUrl, modelName, apiKey, timeoutMs, maxTokens, temperature, isEnabled, isDefault]
    );
    return Number(inserted.insertId || 0);
  });

  const row = await get('SELECT * FROM te_ai_models WHERE id = ? LIMIT 1', [insertedId]);
  res.status(201).json({ ...row, api_key: maskSecret(row?.api_key) });
}));

app.put('/api/train-exam/ai/models/:id', requireAdminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await get('SELECT * FROM te_ai_models WHERE id = ? LIMIT 1', [id]);
  if (!row) throw appError('模型不存在', 404);

  const name = trimText(req.body?.name || row.name);
  const baseUrlInput = trimText(req.body?.base_url !== undefined ? req.body.base_url : row.base_url);
  const modelName = trimText(req.body?.model_name !== undefined ? req.body.model_name : row.model_name);
  const timeoutMs = Math.max(3000, Math.min(120000, Number(req.body?.timeout_ms || row.timeout_ms || 20000)));
  const maxTokens = Math.max(256, Math.min(16000, Number(req.body?.max_tokens || row.max_tokens || 2048)));
  const temperature = Number.isFinite(Number(req.body?.temperature_default)) ? Number(req.body.temperature_default) : Number(row.temperature_default || 0.3);
  const isEnabled = normalizeBoolean(req.body?.is_enabled, Number(row.is_enabled || 0) === 1) ? 1 : 0;
  const isDefault = normalizeBoolean(req.body?.is_default, Number(row.is_default || 0) === 1) ? 1 : 0;
  const apiKey = req.body?.api_key !== undefined ? trimText(req.body.api_key) : trimText(row.api_key);
  if (!baseUrlInput) throw appError('base_url 不能为空', 400);
  const baseUrl = normalizeAiBaseUrlOrThrow(baseUrlInput);

  await transaction(async (tx) => {
    if (isDefault === 1) {
      await tx.run('UPDATE te_ai_models SET is_default = 0 WHERE id <> ?', [id]);
    }
    await tx.run(
      `UPDATE te_ai_models
       SET name = ?, base_url = ?, model_name = ?, api_key = ?, timeout_ms = ?, max_tokens = ?, temperature_default = ?, is_enabled = ?, is_default = ?, updated_at = NOW()
       WHERE id = ?`,
      [name, baseUrl, modelName, apiKey, timeoutMs, maxTokens, temperature, isEnabled, isDefault, id]
    );
  });

  const after = await get('SELECT * FROM te_ai_models WHERE id = ? LIMIT 1', [id]);
  res.json({ ...after, api_key: maskSecret(after.api_key) });
}));

app.delete('/api/train-exam/ai/models/:id', requireAdminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw appError('模型ID无效', 400);
  const row = await get('SELECT * FROM te_ai_models WHERE id = ? LIMIT 1', [id]);
  if (!row) throw appError('模型不存在', 404);

  const totalRow = await get('SELECT COUNT(1) AS total FROM te_ai_models');
  const total = Number(totalRow?.total || 0);
  if (total <= 1) throw appError('至少保留一个模型，不能删除最后一个', 409);

  let nextDefaultId = 0;
  await transaction(async (tx) => {
    await tx.run('DELETE FROM te_ai_models WHERE id = ?', [id]);

    const currentDefaultEnabled = await tx.get(
      'SELECT id FROM te_ai_models WHERE is_default = 1 AND is_enabled = 1 LIMIT 1'
    );
    if (currentDefaultEnabled) {
      nextDefaultId = Number(currentDefaultEnabled.id || 0);
      return;
    }

    const enabledCandidate = await tx.get(
      'SELECT id FROM te_ai_models WHERE is_enabled = 1 ORDER BY is_default DESC, id ASC LIMIT 1'
    );
    let candidateId = Number(enabledCandidate?.id || 0);
    if (!candidateId) {
      const anyCandidate = await tx.get('SELECT id FROM te_ai_models ORDER BY id ASC LIMIT 1');
      candidateId = Number(anyCandidate?.id || 0);
    }
    if (!candidateId) throw appError('删除后未找到可用模型', 409);

    await tx.run('UPDATE te_ai_models SET is_default = 0');
    await tx.run(
      `UPDATE te_ai_models
       SET is_enabled = 1, is_default = 1, updated_at = NOW()
       WHERE id = ?`,
      [candidateId]
    );
    nextDefaultId = candidateId;
  });

  res.json({
    deleted_id: id,
    next_default_id: nextDefaultId,
  });
}));

app.get('/api/train-exam/ai/prompts', requireAuditorReader, asyncHandler(async (_req, res) => {
  const rows = await query('SELECT * FROM te_ai_prompts ORDER BY id ASC');
  res.json(rows);
}));

app.put('/api/train-exam/ai/prompts/:taskType', requirePaperPublisher, asyncHandler(async (req, res) => {
  const taskType = trimText(req.params.taskType).toUpperCase();
  if (!taskType) throw appError('taskType不能为空', 400);
  const promptTemplate = trimText(req.body?.prompt_template);
  if (!promptTemplate) throw appError('prompt_template不能为空', 400);

  await run(
    `INSERT INTO te_ai_prompts (task_type, prompt_template, is_active, updated_by_id, updated_by_name)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       prompt_template = VALUES(prompt_template),
       is_active = VALUES(is_active),
       updated_by_id = VALUES(updated_by_id),
       updated_by_name = VALUES(updated_by_name),
       updated_at = NOW()`,
    [taskType, promptTemplate, Number(req.user.id) || null, req.user.username]
  );

  const row = await get('SELECT * FROM te_ai_prompts WHERE task_type = ? LIMIT 1', [taskType]);
  res.json(row);
}));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `上传文件过大，最大支持 ${Math.round(FILE_MAX_BYTES / (1024 * 1024))}MB`,
      });
    }
    return res.status(400).json({
      error: '上传文件格式不正确，请检查后重试',
    });
  }

  const statusCode = Number(err?.statusCode || err?.status || 500);
  const message = trimText(err?.message || '服务器异常') || '服务器异常';

  if (_req && [401, 403, 429].includes(statusCode)) {
    const action = trimText(err?.securityAction)
      || (statusCode === 401 ? 'AUTH_FAILURE' : statusCode === 403 ? 'ACCESS_DENIED' : 'RATE_LIMIT');
    void logOperation(buildSecurityEventLogPayload({
      req: _req,
      statusCode,
      message: `${action}: ${message}`,
      action,
    }));
  }

  if (statusCode >= 500) {
    console.error('[train-exam] internal error:', err);
  }

  if (statusCode === 429 && Number(err?.retryAfterSeconds || 0) > 0) {
    res.setHeader('Retry-After', String(Number(err.retryAfterSeconds)));
  }

  res.status(statusCode).json({
    error: message,
  });
});

const main = async () => {
  validateSecurityBootstrap();
  await initDb();
  await resumePendingTranscodeJobs();
  app.listen(PORT, () => {
    console.log(`[train-exam] api listening on :${PORT}`);
  });
};

main().catch((err) => {
  console.error('[train-exam] startup failed:', err);
  process.exit(1);
});

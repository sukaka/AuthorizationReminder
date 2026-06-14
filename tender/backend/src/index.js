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
const {
  buildRequirementRows,
  buildClauseRegistryV2,
  buildClauseRouteBuckets,
  buildSectionLinksFromClauseRegistry,
  executeClauseRoutes,
  buildEvidenceRows,
  buildDraftSectionRows,
} = require('./final-draft-registry');
const {
  runStructuredChecks,
  runDocxChecks,
  mergeCheckResults,
} = require('./final-draft-checks');
const {
  buildScoreCoverageMatrix,
  pickOptimizationCandidates,
  normalizeOptimizationResponse,
  buildScoreOptimizationPrompt,
  applyOptimizationToSections,
  buildWinningStrategyProfiles,
  pickWinningStrategyProfile,
  applyWinningStrategyToSuggestions,
} = require('./score-optimization');
const { buildDeviationAndResponseTables } = require('./deviation-response');
const {
  normalizeParseFileRole,
  resolveSelectedSheetNames,
  mergeParsedProjectFields,
  extractArchiveDocumentsFromBuffer,
  extractSpreadsheetWorkbookFromBuffer,
  extractProjectFieldsFromText,
  buildParseClauses,
  buildSpreadsheetTables,
  parseWorkspaceConstants,
} = require('./parse-workspace');
const {
  normalizeDraftSectionRows,
  buildDraftArtifactCollections,
  buildDraftArtifactRowsForSave,
} = require('./draft-workspace');
const {
  buildRiskProjectRow,
  buildRiskCenterOverview,
  sanitizeExportRecordRow: normalizeExportRecordRow,
  buildExportCenterOverview,
  buildTemplateReferenceConflictMessage,
} = require('./ops-center');
const {
  buildSemanticRetrievalChunks,
  buildSemanticFeedbackIndex,
  rankSemanticAssetRecommendations,
} = require('./semantic-retrieval');
const {
  buildKbProjectRecord,
  buildKbScoreItemRows,
  buildKbAssetChunks,
  normalizeTagList,
} = require('./kb-ingest');
const {
  evaluateDatasetResult,
  buildRunSummary,
  buildBaselineDelta,
} = require('./evaluation-kpi');
const {
  buildWordLayoutPlan,
  ensureDocxHeaderFooterBuffer,
  ensureDocxLogicalParagraphsBuffer,
  ensureDocxNativeTocBuffer,
  ensureDocxPageBreakBeforeHeadingsBuffer,
  ensureDocxSectionPageNumberBuffer,
  DOCX_NATIVE_TOC_MARKER,
} = require('./word-layout');
const {
  buildDraftChapterSchema,
  buildDraftChapterQualitySummary,
  normalizeDraftChaptersToSchema,
} = require('./draft-schema');
const {
  buildValidationRuleSeed,
  normalizeValidationRuleRow,
  buildMissingValidationRules,
  decorateIssuesWithRules,
  buildRuleExecutionSummary,
} = require('./validation-rule-library');
const {
  resolveDataScope,
  hasPermission,
  buildPermissionSummary,
  buildGovernancePayload,
  buildFailurePayload,
} = require('./governance');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');

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
const AUDIT_SIGNING_KEY = String(process.env.AUDIT_SIGNING_KEY || '').trim();
const CONFIG_SECRET_KEY = String(process.env.CONFIG_SECRET_KEY || '').trim();

const FILE_MAX_BYTES = Math.max(1024 * 100, Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 30) * 1024 * 1024);
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || '/data/tender/uploads');
const VERSION_ROOT = path.resolve(process.env.VERSION_ROOT || `${UPLOAD_ROOT}/versions`);
const DRAFT_ROOT = path.resolve(process.env.DRAFT_ROOT || `${UPLOAD_ROOT}/drafts`);
const ASSET_ROOT = path.resolve(process.env.ASSET_ROOT || `${UPLOAD_ROOT}/assets`);
const SAMPLE_ROOT = path.resolve(process.env.SAMPLE_ROOT || `${UPLOAD_ROOT}/samples`);
const TEMPLATE_ROOT = path.resolve(process.env.TEMPLATE_ROOT || `${UPLOAD_ROOT}/doc-templates`);
const WATERMARK_ROOT = path.resolve(process.env.WATERMARK_ROOT || `${UPLOAD_ROOT}/watermarks`);
const PREVIEW_ROOT = path.resolve(process.env.PREVIEW_ROOT || `${UPLOAD_ROOT}/previews`);
const EDITABLE_ROOT = path.resolve(process.env.EDITABLE_ROOT || `${UPLOAD_ROOT}/editable`);
const EXPORT_ROOT = path.resolve(process.env.EXPORT_ROOT || `${UPLOAD_ROOT}/exports`);
const PARSE_ROOT = path.resolve(process.env.PARSE_ROOT || `${UPLOAD_ROOT}/parse-workspace`);
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
const DIFF_MAX_SEGMENTS = Math.max(100, Math.min(1200, Number(process.env.TENDER_DIFF_MAX_SEGMENTS || 500)));
const DIFF_MAX_ENTRIES = Math.max(100, Math.min(1500, Number(process.env.TENDER_DIFF_MAX_ENTRIES || 600)));
const EDITOR_EVENTS_MAX_LIMIT = Math.max(20, Math.min(300, Number(process.env.TENDER_EDITOR_EVENTS_MAX_LIMIT || 120)));
const OCR_ENDPOINT_DEFAULT = 'ocr.cn-beijing.aliyuncs.com';
const OCR_API_VERSION_DEFAULT = '2021-07-07';
const OCR_TIMEOUT_MS_DEFAULT = 15000;

const SECRET_MASK = '******';
const APP_NAME = 'tender';
const APP_VERSION = process.env.APP_VERSION || process.env.npm_package_version || 'unknown';
const BUILD_COMMIT = process.env.BUILD_COMMIT || process.env.GIT_COMMIT || '';
const BUILD_TIME = process.env.BUILD_TIME || process.env.BUILT_AT || '';
const weakSecrets = new Set(['dev-secret-change-me', 'change-me', '123456', 'password', '']);

const observabilityMetrics = {
  service: APP_NAME,
  startedAt: new Date().toISOString(),
  requestTotal: 0,
  errorTotal: 0,
  inFlight: 0,
  durationMsTotal: 0,
  durationMsMax: 0,
  statusCounts: {},
};

const normalizeRequestId = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, 128).replace(/[^a-zA-Z0-9_.:-]/g, '');
};

const buildMetricsSnapshot = () => ({
  service: APP_NAME,
  started_at: observabilityMetrics.startedAt,
  uptime_seconds: Math.round(process.uptime()),
  request_total: observabilityMetrics.requestTotal,
  error_total: observabilityMetrics.errorTotal,
  in_flight: observabilityMetrics.inFlight,
  duration_ms_avg: observabilityMetrics.requestTotal
    ? Number((observabilityMetrics.durationMsTotal / observabilityMetrics.requestTotal).toFixed(2))
    : 0,
  duration_ms_max: Number(observabilityMetrics.durationMsMax.toFixed(2)),
  status_counts: observabilityMetrics.statusCounts,
});

const observabilityMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const requestId = normalizeRequestId(req.get('X-Request-Id') || req.get('X-Correlation-Id')) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  observabilityMetrics.inFlight += 1;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const statusCode = Number(res.statusCode || 0);
    observabilityMetrics.inFlight = Math.max(0, observabilityMetrics.inFlight - 1);
    observabilityMetrics.requestTotal += 1;
    observabilityMetrics.durationMsTotal += durationMs;
    observabilityMetrics.durationMsMax = Math.max(observabilityMetrics.durationMsMax, durationMs);
    observabilityMetrics.statusCounts[statusCode] = (observabilityMetrics.statusCounts[statusCode] || 0) + 1;
    if (statusCode >= 500) observabilityMetrics.errorTotal += 1;
    console.info(JSON.stringify({
      type: 'http_access',
      service: APP_NAME,
      request_id: requestId,
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      status: statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      remote_ip: req.ip || req.socket?.remoteAddress || '',
    }));
  });

  next();
};

const ALLOWED_BID_UPLOAD_EXTS = new Set(['.doc', '.docx', '.pdf']);
const ALLOWED_BID_UPLOAD_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]);
const ALLOWED_PARSE_UPLOAD_EXTS = new Set(['.doc', '.docx', '.pdf', '.xls', '.xlsx', '.zip']);
const ALLOWED_PARSE_UPLOAD_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

const ALLOWED_ASSET_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const ALLOWED_ASSET_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const ALLOWED_DOC_TEMPLATE_EXTS = new Set(['.docx']);
const ALLOWED_DOC_TEMPLATE_MIME = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

const SAMPLE_PARSE_MAX_TEXT = Math.max(120000, Math.min(500000, Number(process.env.SAMPLE_PARSE_MAX_TEXT || 220000)));
const BID_ANALYZE_MAX_TEXT = Math.max(180000, Math.min(600000, Number(process.env.BID_ANALYZE_MAX_TEXT || 320000)));
const SAMPLE_MATCH_CANDIDATE_LIMIT = Math.max(10, Math.min(80, Number(process.env.SAMPLE_MATCH_CANDIDATE_LIMIT || 30)));
const BID_CATEGORY_ALIASES = new Map([
  ['SERVICE', 'SERVICE'],
  ['服务', 'SERVICE'],
  ['服务类', 'SERVICE'],
  ['服务型', 'SERVICE'],
  ['产品', 'PRODUCT'],
  ['产品类', 'PRODUCT'],
  ['货物', 'PRODUCT'],
  ['货物类', 'PRODUCT'],
  ['PRODUCT', 'PRODUCT'],
]);
const BID_CATEGORY_LABELS = {
  SERVICE: '服务类',
  PRODUCT: '产品类',
};

const tenderSectionDefs = [
  {
    key: 'INVITATION',
    title: '投标邀请',
    aliases: ['投标邀请', '招标公告', '招标邀请', '投标邀请书'],
  },
  {
    key: 'BIDDER_INSTRUCTION',
    title: '投标人须知',
    aliases: ['投标人须知', '投标须知', '投标须知前附表', '供应商须知'],
  },
  {
    key: 'BIDDER_INSTRUCTION_TABLE',
    title: '投标人须知前附表',
    aliases: ['投标人须知前附表', '须知前附表', '供应商须知前附表'],
  },
  {
    key: 'PROCUREMENT_REQUIREMENT',
    title: '采购需求',
    aliases: ['采购需求', '项目需求', '技术需求', '技术要求'],
  },
  {
    key: 'TECH_PARAM_TABLE',
    title: '技术参数表',
    aliases: ['技术参数表', '技术参数', '参数表', '技术要求表'],
  },
  {
    key: 'SCORING_STANDARD',
    title: '评标方法与评标标准',
    aliases: ['评标方法与评标标准', '评标办法', '评分办法', '评分标准', '评审标准', '综合评分法'],
  },
  {
    key: 'CONTRACT_TERMS',
    title: '合同主要条款及格式',
    aliases: ['合同主要条款及格式', '合同主要条款', '合同条款', '合同格式'],
  },
  {
    key: 'ATTACHMENT',
    title: '附件',
    aliases: ['附件', '附件清单', '附件资料'],
  },
  {
    key: 'SCORE_TABLE',
    title: '评分表',
    aliases: ['评分表', '评分标准表', '评审评分表', '打分表'],
  },
  {
    key: 'BID_DOC_FORMAT',
    title: '投标文件格式',
    aliases: ['投标文件格式', '响应文件格式', '投标文件编制格式', '格式附件'],
  },
];

for (const dir of [UPLOAD_ROOT, VERSION_ROOT, DRAFT_ROOT, ASSET_ROOT, SAMPLE_ROOT, TEMPLATE_ROOT, WATERMARK_ROOT, PREVIEW_ROOT, EDITABLE_ROOT, EXPORT_ROOT, PARSE_ROOT]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const defaultOrigins = ['http://localhost:18086', 'http://127.0.0.1:18086'].map(normalizeOrigin);
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
app.use(observabilityMiddleware);
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
const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = trimText(value);
    if (text) return text;
  }
  return '';
};

const normalizeBidCategory = (value) => {
  const raw = trimText(value);
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (BID_CATEGORY_ALIASES.has(upper)) return BID_CATEGORY_ALIASES.get(upper);
  if (BID_CATEGORY_ALIASES.has(raw)) return BID_CATEGORY_ALIASES.get(raw);
  return '';
};

const bidCategoryLabel = (value) => BID_CATEGORY_LABELS[normalizeBidCategory(value)] || '未识别';
const ANALYZE_STAGE_TASK_TYPES = {
  STAGE1: 'BID_ANALYZE_STAGE1',
  STAGE2: 'BID_ANALYZE_STAGE2',
  STAGE3: 'BID_ANALYZE_STAGE3',
};
const ANALYZE_STAGE_TASK_TYPE_SET = new Set(Object.values(ANALYZE_STAGE_TASK_TYPES));
const AI_ANALYZE_TASK_TIMEOUT_MS = Math.max(30000, Number(process.env.AI_ANALYZE_TASK_TIMEOUT_MS || 120000));
const ANALYZE_MIN_TEXT_LENGTH = 120;
const ANALYZE_MIN_STRUCTURED_CHAPTER_HITS = 2;
const ANALYZE_ESTIMATED_LINES_PER_PAGE = 45;
const RISK_CLAUSE_TYPE_SET = new Set([
  'QUALIFICATION_INVALID',
  'COMPLIANCE_INVALID',
  'PERSONNEL_INVALID',
  'SERVICE_SCHEME_INVALID',
  'SLA_INVALID',
  'BUSINESS_INVALID',
  'QUOTATION_INVALID',
  'SIGNATURE_SEAL_INVALID',
  'OTHER_INVALID',
]);
const RISK_CLAUSE_TARGET_MAP = {
  QUALIFICATION_INVALID: 'qualification_invalid_clauses',
  COMPLIANCE_INVALID: 'compliance_invalid_clauses',
  PERSONNEL_INVALID: 'personnel_invalid_clauses',
  SERVICE_SCHEME_INVALID: 'service_scheme_invalid_clauses',
  SLA_INVALID: 'sla_invalid_clauses',
  BUSINESS_INVALID: 'business_invalid_clauses',
  QUOTATION_INVALID: 'quotation_invalid_clauses',
  SIGNATURE_SEAL_INVALID: 'signature_seal_invalid_clauses',
  OTHER_INVALID: 'other_invalid_clauses',
};
const MISSING_ITEM_TYPE_SET = new Set([
  'INVALID_BID_CLAUSE',
  'SUBSTANTIVE_REQUIREMENT',
  'SLA_INDICATOR',
  'PERSONNEL_REQUIREMENT',
  'SCORING_ITEM',
  'QUOTATION_RULE',
  'TECH_PARAMETER',
  'CORE_PRODUCT',
  'AUTH_REQUIREMENT',
  'CERTIFICATION_REQUIREMENT',
  'SAMPLE_REQUIREMENT',
]);
const REQUIRED_ANALYZE_CHAPTERS = [
  { key: 'BIDDER_INSTRUCTION', title: '投标人须知' },
  { key: 'BIDDER_INSTRUCTION_TABLE', title: '投标人须知前附表' },
  { key: 'PROCUREMENT_REQUIREMENT', title: '采购需求' },
  { key: 'TECH_PARAM_TABLE', title: '技术参数表' },
  { key: 'SCORING_STANDARD', title: '评标办法' },
  { key: 'CONTRACT_TERMS', title: '合同条款' },
  { key: 'ATTACHMENT', title: '附件' },
  { key: 'SCORE_TABLE', title: '评分表' },
];
const STAGE1_FORCE_KEYWORDS = [
  '无效投标',
  '否决投标',
  '废标',
  '负偏离',
  '实质性要求',
  '不满足',
  '★',
  '▲',
];
const SERVICE_STAGE_KEYWORDS = {
  sla: ['响应时间', '恢复时间', '服务可用性', '故障处理'],
  personnel: ['项目经理', '项目负责人', '技术负责人', '工程师', '驻场'],
  price: ['最高限价', '投标报价', '分项报价', '价格评分'],
  contract: ['违约责任', '考核', '扣款', '服务考核'],
  technical: ['服务方案', '技术方案', '实施方案'],
};
const PRODUCT_STAGE_KEYWORDS = {
  technical: ['技术参数', '参数要求', '核心参数', '核心产品', '主要产品', '负偏离'],
  authorization: ['原厂授权', '唯一授权', '制造商授权'],
  certification: ['3C认证', '节能认证', '环境标志认证', '检测报告'],
  sample: ['样品', '样机', '演示设备'],
  price: ['最高限价', '投标报价', '分项报价', '价格评分'],
  contract: ['违约责任', '考核', '扣款', '服务考核'],
  personnel: ['项目经理', '项目负责人', '技术负责人', '工程师', '驻场'],
};

const resolveStageKeywordGroups = (bidCategory = 'SERVICE') => {
  const category = normalizeBidCategory(bidCategory);
  return category === 'PRODUCT' ? PRODUCT_STAGE_KEYWORDS : SERVICE_STAGE_KEYWORDS;
};

const buildStage1EnforcedRules = (bidCategory = 'SERVICE') => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const groups = resolveStageKeywordGroups(category);
  if (category === 'PRODUCT') {
    return [
      '【货物类规则-必须执行】',
      '1) 必须强制扫描关键词：无效投标、否决投标、废标、负偏离、实质性要求、不满足、★、▲。',
      '2) 必须逐行扫描技术参数表、评分表、报价表，命中实质性/无效条件时逐条输出风险。',
      '2.1) 每条风险必须输出 source_reference.chapter、source_reference.page_number、source_reference.excerpt（原文片段）。',
      '2.2) clause_content 必须是原文原句，不得改写。',
      `3) 技术参数重点词：${groups.technical.join('、')}。`,
      `4) 原厂授权重点词：${groups.authorization.join('、')}。`,
      `5) 认证要求重点词：${groups.certification.join('、')}。`,
      `6) 样品要求重点词：${groups.sample.join('、')}。`,
      `7) 报价重点词：${groups.price.join('、')}。`,
      `8) 合同扣罚重点词：${groups.contract.join('、')}。`,
    ].join('\n');
  }
  return [
    '【服务类规则-必须执行】',
    '1) 必须强制扫描关键词：无效投标、否决投标、废标、负偏离、实质性要求、不满足、★、▲。',
    '2) 必须扫描评分表中的评分项，凡与废标/否决/实质性相关的条款都要纳入风险条款。',
    '2.1) 每条风险必须输出 source_reference.chapter、source_reference.page_number、source_reference.excerpt（原文片段）。',
    '2.2) clause_content 必须是原文原句，不得改写。',
    `3) SLA重点词必须扫描：${groups.sla.join('、')}。`,
    `4) 人员条款重点词必须扫描：${groups.personnel.join('、')}。`,
    `5) 报价条款重点词必须扫描：${groups.price.join('、')}。`,
    `6) 合同条款重点词必须扫描：${groups.contract.join('、')}。`,
  ].join('\n');
};

const buildStage2EnforcedRules = (bidCategory = 'SERVICE') => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const groups = resolveStageKeywordGroups(category);
  if (category === 'PRODUCT') {
    return [
      '【货物类规则-必须执行】',
      '1) 评分表中的所有评分项必须逐条提取，不得汇总省略。',
      '1.1) 所有实质性条款、评分标准、报价规则必须保留原文原句。',
      '2) 必须检查章节：投标人须知、投标人须知前附表、采购需求、技术参数表、评标办法、合同条款、附件、评分表。',
      `3) 技术参数关键字必须写入结构化结果：${groups.technical.join('、')}。`,
      `4) 原厂授权条款必须提取：${groups.authorization.join('、')}。`,
      `5) 认证条款必须提取：${groups.certification.join('、')}。`,
      `6) 样品条款必须提取：${groups.sample.join('、')}。`,
      `7) 报价规则必须提取：${groups.price.join('、')}。`,
      `8) 合同扣罚条款必须提取：${groups.contract.join('、')}。`,
      '9) 必须输出字段：goods_procurement_detail、core_product_info、evaluation_score_matrix、technical_deviation_table。',
    ].join('\n');
  }
  return [
    '【服务类规则-必须执行】',
    '1) 评分表中的所有评分项必须逐条提取，不得汇总省略。',
    '1.1) 所有实质性条款、评分标准、报价规则必须保留原文原句。',
    '2) 必须检查章节：投标人须知、投标人须知前附表、采购需求、评标办法、合同条款、附件、评分表。',
    `3) SLA关键指标必须写入结构化结果：${groups.sla.join('、')}。`,
    `4) 人员关键岗位必须写入结构化结果：${groups.personnel.join('、')}。`,
    `5) 报价关键规则必须写入结构化结果：${groups.price.join('、')}。`,
    `6) 合同考核与扣款必须写入结构化结果：${groups.contract.join('、')}。`,
  ].join('\n');
};

const buildStage3EnforcedRules = (bidCategory = 'SERVICE') => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const groups = resolveStageKeywordGroups(category);
  const sharedLines = [
    '【行业规则-必须执行】',
    '交叉校验必须特别检查是否遗漏以下关键词条款：',
    '输出 missing_items 时必须包含 source_reference.chapter、source_reference.page_number、source_reference.excerpt。',
    `- 强制风险词：${STAGE1_FORCE_KEYWORDS.join('、')}`,
    `- 报价词：${groups.price.join('、')}`,
    `- 合同词：${groups.contract.join('、')}`,
  ];
  if (category === 'PRODUCT') {
    sharedLines.push(`- 技术参数词：${groups.technical.join('、')}`);
    sharedLines.push(`- 原厂授权词：${groups.authorization.join('、')}`);
    sharedLines.push(`- 认证词：${groups.certification.join('、')}`);
    sharedLines.push(`- 样品词：${groups.sample.join('、')}`);
  } else {
    sharedLines.push(`- SLA词：${groups.sla.join('、')}`);
    sharedLines.push(`- 人员词：${groups.personnel.join('、')}`);
  }
  return sharedLines.join('\n');
};

const countCjkChars = (value) => {
  const text = String(value || '');
  const matches = text.match(/[\u3400-\u9fff]/g);
  return matches ? matches.length : 0;
};

const countLatin1HighChars = (value) => {
  const text = String(value || '');
  const matches = text.match(/[\u0080-\u00ff]/g);
  return matches ? matches.length : 0;
};

const decodeLatin1Utf8Segment = (text) => {
  const raw = trimText(text);
  if (!raw) return raw;
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) return raw;
    const rawCjk = countCjkChars(raw);
    const decodedCjk = countCjkChars(decoded);
    if (decodedCjk > rawCjk) return decoded;
    const rawHigh = countLatin1HighChars(raw);
    const decodedHigh = countLatin1HighChars(decoded);
    if (rawHigh > 0 && decodedHigh < rawHigh) return decoded;
    return raw;
  } catch {
    return raw;
  }
};

const fixMojibakeText = (value) => {
  const text = trimText(value);
  if (!text) return text;
  const wholeDecoded = decodeLatin1Utf8Segment(text);
  if (wholeDecoded !== text) return wholeDecoded;

  // 支持“前半段乱码、后半段正常”的混合文本。
  const segmentedDecoded = text.replace(/[\u0080-\u00ff]{2,}/g, (segment) => decodeLatin1Utf8Segment(segment));
  if (segmentedDecoded !== text) return segmentedDecoded;
  return text;
};

const normalizeUploadFileName = (req) => {
  if (!req?.file) return;
  req.file.originalname = fixMojibakeText(req.file.originalname);
};

const sanitizeBidRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    bid_no: fixMojibakeText(row.bid_no),
    title: fixMojibakeText(row.title),
    customer_name: fixMojibakeText(row.customer_name),
    project_name: fixMojibakeText(row.project_name),
    summary: fixMojibakeText(row.summary),
    review_status: fixMojibakeText(row.review_status),
    review_stage: fixMojibakeText(row.review_stage),
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
    submitted_by_name: fixMojibakeText(row.submitted_by_name),
    archived_by_name: fixMojibakeText(row.archived_by_name),
  };
};

const sanitizeBidMemberRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    member_username: fixMojibakeText(row.member_username),
    member_role: fixMojibakeText(row.member_role),
    member_title: fixMojibakeText(row.member_title),
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
  };
};

const sanitizeVersionRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    file_name: fixMojibakeText(row.file_name),
    created_by_name: fixMojibakeText(row.created_by_name),
  };
};

const sanitizeDraftRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    draft_file_name: fixMojibakeText(row.draft_file_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
  };
};

const sanitizeDraftAutosaveRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    file_name: fixMojibakeText(row.file_name),
    note: fixMojibakeText(row.note),
    saved_by_name: fixMojibakeText(row.saved_by_name),
  };
};

const sanitizeExportRecordRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const normalized = normalizeExportRecordRow(row);
  return {
    ...normalized,
    file_name: fixMojibakeText(normalized.file_name),
    error_message: fixMojibakeText(normalized.error_message),
    created_by_name: fixMojibakeText(normalized.created_by_name),
  };
};

const sanitizeDraftArtifactRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    artifact_type: trimText(row.artifact_type).toUpperCase() || 'DEVIATION_TABLE',
    artifact_group: trimText(row.artifact_group).toUpperCase() || 'TECHNICAL',
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
    row_json: parseMaybeJson(row.row_json, {}),
  };
};

const sanitizeDraftCheckRunRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    status: trimText(row.status).toUpperCase() || 'COMPLETED',
    created_by_name: fixMojibakeText(row.created_by_name),
    summary: parseMaybeJson(row.summary_json, {}),
  };
};

const sanitizeDraftCheckIssueRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    severity: trimText(row.severity).toUpperCase() || 'WARN',
    title: fixMojibakeText(row.title),
    message: fixMojibakeText(row.message),
    requirement_title: fixMojibakeText(row.requirement_title),
    section_title: fixMojibakeText(row.section_title),
    paragraph_text: fixMojibakeText(row.paragraph_text),
  };
};

const sanitizeValidationRuleRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const normalized = normalizeValidationRuleRow(row);
  return {
    ...normalized,
    rule_name: fixMojibakeText(normalized.rule_name),
    trigger_condition: fixMojibakeText(normalized.trigger_condition),
    check_logic: fixMojibakeText(normalized.check_logic),
    suggested_action: fixMojibakeText(normalized.suggested_action),
  };
};

const sanitizeScoreCoverageRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    title: fixMojibakeText(row.title),
    coverage_status: trimText(row.coverage_status).toUpperCase() || 'NONE',
    optimization_reason: fixMojibakeText(row.optimization_reason),
    target_section_title: fixMojibakeText(row.target_section_title),
    bound_evidence_ids: parseMaybeJson(row.bound_evidence_ids_json, []),
  };
};

const sanitizeScoreOptimizationRecordRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    suggestion_title: fixMojibakeText(row.suggestion_title),
    suggestion_text: fixMojibakeText(row.suggestion_text),
    target_section_title: fixMojibakeText(row.target_section_title),
    before_text: fixMojibakeText(row.before_text),
    after_text: fixMojibakeText(row.after_text),
    status: trimText(row.status).toUpperCase() || 'PROPOSED',
    source: trimText(row.source).toUpperCase() || 'RULE',
    strategy_profile_key: trimText(row.strategy_profile_key),
    created_by_name: fixMojibakeText(row.created_by_name),
    evidence_ids: parseMaybeJson(row.evidence_ids_json, []),
    audit_trace: parseMaybeJson(row.audit_trace_json, {}),
  };
};

const sanitizeAssetRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    original_file_name: fixMojibakeText(row.original_file_name),
    uploaded_by_name: fixMojibakeText(row.uploaded_by_name),
    reviewer_name: fixMojibakeText(row.reviewer_name),
  };
};

const sanitizeParseJobRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    parse_scope: trimText(row.parse_scope).toUpperCase() || 'FULL',
    status: trimText(row.status).toUpperCase() || 'PENDING',
    operator_name: fixMojibakeText(row.operator_name),
    warning_text: fixMojibakeText(row.warning_text),
    error_message: fixMojibakeText(row.error_message),
    merged_fields: parseMaybeJson(row.merged_fields_json, {}),
    field_sources: parseMaybeJson(row.field_sources_json, {}),
    summary: parseMaybeJson(row.summary_json, {}),
  };
};

const sanitizeParseFileRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    file_role: normalizeParseFileRole(row.file_role),
    file_kind: trimText(row.file_kind).toUpperCase() || 'UPLOAD',
    status: trimText(row.status).toUpperCase() || 'UPLOADED',
    original_file_name: fixMojibakeText(row.original_file_name),
    display_name: fixMojibakeText(row.display_name),
    uploaded_by_name: fixMojibakeText(row.uploaded_by_name),
    sheet_manifest: parseMaybeJson(row.sheet_manifest_json, []),
    selected_sheet_names: parseMaybeJson(row.selected_sheets_json, []),
    parse_summary: parseMaybeJson(row.parse_summary_json, {}),
  };
};

const sanitizeParseClauseRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    clause_code: trimText(row.clause_code),
    clause_title: fixMojibakeText(row.clause_title),
    clause_text: fixMojibakeText(row.clause_text),
    clause_type: trimText(row.clause_type).toUpperCase() || 'GENERAL',
    response_mode: trimText(row.response_mode).toUpperCase() || 'TEXT',
    source_role: normalizeParseFileRole(row.source_role),
    metadata: parseMaybeJson(row.metadata_json, {}),
  };
};

const sanitizeParseTableRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    table_name: fixMojibakeText(row.table_name),
    source_sheet_name: fixMojibakeText(row.source_sheet_name),
    summary_text: fixMojibakeText(row.summary_text),
    source_role: normalizeParseFileRole(row.source_role),
    header: parseMaybeJson(row.header_json, []),
    rows: parseMaybeJson(row.rows_json, []),
  };
};

const sanitizeParseMatchRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    match_status: trimText(row.match_status).toUpperCase() || 'RECOMMENDED',
    reason_text: fixMojibakeText(row.reason_text),
    match_source: trimText(row.match_source).toUpperCase() || 'RULE',
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
    payload: parseMaybeJson(row.payload_json, {}),
  };
};

const sanitizeKbProjectRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    project_name: fixMojibakeText(row.project_name),
    project_no: fixMojibakeText(row.project_no),
    purchaser: fixMojibakeText(row.purchaser),
    industry_type: fixMojibakeText(row.industry_type),
    project_type: fixMojibakeText(row.project_type),
    region: fixMojibakeText(row.region),
    result_status: fixMojibakeText(row.result_status),
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
  };
};

const sanitizeKbIngestJobRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    job_type: trimText(row.job_type).toUpperCase() || 'BID_PROJECT_INGEST',
    source_file: fixMojibakeText(row.source_file),
    status: trimText(row.status).toUpperCase() || 'PENDING',
    error_message: fixMojibakeText(row.error_message),
    operator_name: fixMojibakeText(row.operator_name),
    input_payload: parseMaybeJson(row.input_payload, {}),
    output_summary: parseMaybeJson(row.output_summary, {}),
  };
};

const TENDER_EVAL_TYPES = ['CLAUSE_RECOGNITION', 'SCORE_COVERAGE', 'MATERIAL_MATCHING', 'RISK_RECALL', 'EXPORT_COMPLETENESS'];

const normalizeEvaluationType = (value) => {
  const normalized = trimText(value).toUpperCase();
  return TENDER_EVAL_TYPES.includes(normalized) ? normalized : '';
};

const sanitizeEvaluationDatasetRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    dataset_code: fixMojibakeText(row.dataset_code),
    dataset_name: fixMojibakeText(row.dataset_name),
    eval_type: normalizeEvaluationType(row.eval_type),
    source_bid_id: Number(row.source_bid_id || 0) || null,
    baseline_flag: Number(row.baseline_flag || 0) === 1,
    status: trimText(row.status).toUpperCase() || 'ACTIVE',
    expected_payload: parseMaybeJson(row.expected_payload_json, {}),
    notes: fixMojibakeText(row.notes),
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
  };
};

const sanitizeEvaluationRunRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    run_no: fixMojibakeText(row.run_no),
    run_label: fixMojibakeText(row.run_label),
    run_scope: trimText(row.run_scope).toUpperCase() || 'ADHOC',
    status: trimText(row.status).toUpperCase() || 'SUCCESS',
    dataset_count: Number(row.dataset_count || 0) || 0,
    summary: parseMaybeJson(row.summary_json, {}),
    baseline_summary: parseMaybeJson(row.baseline_summary_json, {}),
    started_by_name: fixMojibakeText(row.started_by_name),
  };
};

const sanitizeEvaluationRunItemRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    eval_type: normalizeEvaluationType(row.eval_type),
    source_bid_id: Number(row.source_bid_id || 0) || null,
    score: Number(row.score || 0) || 0,
    status: trimText(row.status).toUpperCase() || 'PASS',
    result: parseMaybeJson(row.result_json, {}),
    delta: parseMaybeJson(row.delta_json, {}),
    dataset_name: fixMojibakeText(row.dataset_name),
    dataset_code: fixMojibakeText(row.dataset_code),
  };
};

const normalizeKbResultStatus = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (['WON', 'LOST', 'IN_PROGRESS', 'ABANDONED', 'UNKNOWN'].includes(normalized)) return normalized;
  return '';
};

const normalizeDateTimeInput = (value) => {
  const text = trimText(value);
  if (!text) return null;

  // 优先兼容标准数据库时间字符串，避免时区偏移。
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?$/);
  if (directMatch) {
    const datePart = directMatch[1];
    const hmPart = directMatch[2] || '00:00';
    const secPart = directMatch[3] || '00';
    return `${datePart} ${hmPart}:${secPart}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateTime(parsed);
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

const buildManualTakeover = (action, target = '', extra = {}) => ({
  action: trimText(action),
  target: trimText(target) || null,
  ...extra,
});

const appError = (message, statusCode = 400, meta = {}) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (meta && typeof meta === 'object') {
    Object.assign(err, meta);
  }
  return err;
};

const tenderStageError = ({
  message,
  statusCode = 400,
  code = 'TENDER_REQUEST_FAILED',
  category = 'REQUEST',
  retryable = false,
  manualTakeover = null,
  details = null,
}) => appError(message, statusCode, {
  code,
  category,
  retryable: !!retryable,
  manual_takeover: manualTakeover || null,
  details: details && typeof details === 'object' ? details : null,
});

const uploadValidationError = (message, options = {}) => tenderStageError({
  message,
  statusCode: Number(options.statusCode || 400),
  code: options.code || 'TENDER_UPLOAD_INVALID_FILE',
  category: 'UPLOAD',
  retryable: false,
  manualTakeover: options.manualTakeover || buildManualTakeover('请调整文件后重新上传', 'upload'),
  details: options.details || null,
});

const bidScopeForbiddenError = (message = '当前账号无权访问该标书') => tenderStageError({
  message,
  statusCode: 403,
  code: 'TENDER_SCOPE_FORBIDDEN',
  category: 'PERMISSION',
  retryable: false,
  manualTakeover: buildManualTakeover('请联系项目管理员分派成员或切换到有权限的账号', 'permission'),
});

const isMysqlDeadlockError = (err) => {
  const code = String(err?.code || '').toUpperCase();
  if (code === 'ER_LOCK_DEADLOCK') return true;
  const message = String(err?.message || '').toLowerCase();
  return message.includes('deadlock found when trying to get lock');
};

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withDeadlockRetry = async (task, options = {}) => {
  const maxRetries = Number.isFinite(Number(options.maxRetries)) ? Number(options.maxRetries) : 2;
  const baseDelayMs = Number.isFinite(Number(options.baseDelayMs)) ? Number(options.baseDelayMs) : 80;
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (err) {
      if (!isMysqlDeadlockError(err) || attempt >= maxRetries) throw err;
      await waitMs(baseDelayMs * (attempt + 1));
      attempt += 1;
    }
  }
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

const BID_STATUS_SET = new Set([
  'DRAFT',
  'FILES_UPLOADED',
  'PARSE_COMPLETED',
  'MATERIALS_PENDING',
  'READY_TO_GENERATE',
  'GENERATING',
  'COMPILE_REVIEW_PENDING',
  'TECH_REVIEW_PENDING',
  'BUSINESS_REVIEW_PENDING',
  'FINAL_REVIEW_PENDING',
  'EXPORT_READY',
  'EXPORTED',
  'ARCHIVED',
  // 兼容历史状态
  'IN_REVIEW',
  'FINALIZED',
  'SUBMITTED',
]);

const REVIEW_STATUS_SET = new Set(['draft', 'submitted', 'approved', 'rejected', 'returned', 'conditional']);
const REVIEW_STAGE_SET = new Set(['COMPILE', 'TECH', 'BUSINESS', 'FINAL']);

const normalizeStatus = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (BID_STATUS_SET.has(normalized)) return normalized;
  return 'DRAFT';
};

const normalizeReviewStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (REVIEW_STATUS_SET.has(normalized)) return normalized;
  return 'draft';
};

const normalizeReviewStage = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (REVIEW_STAGE_SET.has(normalized)) return normalized;
  return 'COMPILE';
};

const inferReviewStageByBidStatus = (status) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'TECH_REVIEW_PENDING') return 'TECH';
  if (normalized === 'BUSINESS_REVIEW_PENDING') return 'BUSINESS';
  if (normalized === 'FINAL_REVIEW_PENDING') return 'FINAL';
  return 'COMPILE';
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


const decodeXmlEntities = (value) => String(value || '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, '\'')
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  })
  .replace(/&#([0-9]+);/g, (_m, num) => {
    const code = Number.parseInt(num, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });

const extractWordRunText = (xml) => {
  if (!trimText(xml)) return '';
  const rows = [];
  const regex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let matched = regex.exec(xml);
  while (matched) {
    const text = decodeXmlEntities(matched[1] || '');
    if (text) rows.push(text);
    matched = regex.exec(xml);
  }
  return trimText(rows.join(''));
};

const extractDocxTableBlocks = async (docxPath, options = {}) => {
  const maxTables = Math.max(1, Math.min(80, Number(options.maxTables || 40)));
  const maxRows = Math.max(1, Math.min(400, Number(options.maxRows || 180)));
  const maxCols = Math.max(1, Math.min(60, Number(options.maxCols || 20)));
  const maxCellLen = Math.max(10, Math.min(2000, Number(options.maxCellLen || 240)));

  const target = trimText(docxPath);
  if (!target) return [];
  try {
    const bytes = await fs.promises.readFile(target);
    const zip = new PizZip(bytes);
    const xml = zip.file('word/document.xml')?.asText() || '';
    if (!trimText(xml)) return [];

    const tables = [];
    const tableRegex = /<w:tbl[\s\S]*?<\/w:tbl>/g;
    let tableMatch = tableRegex.exec(xml);
    while (tableMatch && tables.length < maxTables) {
      const tableXml = tableMatch[0];
      const parsedRows = [];
      const rowRegex = /<w:tr[\s\S]*?<\/w:tr>/g;
      let rowMatch = rowRegex.exec(tableXml);
      while (rowMatch && parsedRows.length < maxRows) {
        const rowXml = rowMatch[0];
        const rowCells = [];
        const cellRegex = /<w:tc[\s\S]*?<\/w:tc>/g;
        let cellMatch = cellRegex.exec(rowXml);
        while (cellMatch && rowCells.length < maxCols) {
          const cellXml = cellMatch[0];
          const cellText = normalizeSearchText(extractWordRunText(cellXml), maxCellLen);
          rowCells.push(cellText || '未明确');
          cellMatch = cellRegex.exec(rowXml);
        }
        if (rowCells.some((cell) => trimText(cell) && trimText(cell) !== '未明确')) {
          parsedRows.push(rowCells);
        }
        rowMatch = rowRegex.exec(tableXml);
      }

      if (parsedRows.length) {
        const firstRow = Array.isArray(parsedRows[0]) ? parsedRows[0] : [];
        const hasHeader = firstRow.some((cell) => trimText(cell) && trimText(cell) !== '未明确');
        const header = hasHeader ? firstRow : [];
        const bodyRows = hasHeader ? parsedRows.slice(1) : parsedRows;
        const columnCount = parsedRows.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0);
        const previewRows = parsedRows.slice(0, 3).map((row) => row.join(' | ')).filter(Boolean);
        const mergedText = parsedRows.flat().join(' ');
        tables.push({
          table_index: tables.length + 1,
          row_count: parsedRows.length,
          column_count: columnCount,
          header,
          rows: bodyRows.slice(0, maxRows),
          summary: normalizeAnalysisText(previewRows.join('；'), 480),
          keywords: extractKeywords(mergedText, 16),
        });
      }
      tableMatch = tableRegex.exec(xml);
    }
    return tables;
  } catch {
    return [];
  }
};

const resolveBidVersionSearchText = async (version) => {
  if (!version) return '';
  const rawExt = trimText(version.source_ext).toLowerCase();
  const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
  const sourcePath = trimText(version.storage_path);
  if (!sourcePath) return '';

  if (ext === '.docx') return extractDocxSearchText(sourcePath);
  if (ext === '.doc') {
    const tempDir = path.join(EDITABLE_ROOT, `compare-${Date.now()}-${crypto.randomUUID()}`);
    let convertedPath = '';
    try {
      convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'docx');
      return extractDocxSearchText(convertedPath);
    } catch {
      return '';
    } finally {
      if (convertedPath) {
        await deleteFileSafe(convertedPath);
      }
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore temp cleanup error
      }
    }
  }
  return '';
};

const sanitizeSampleRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    sample_no: fixMojibakeText(row.sample_no),
    title: fixMojibakeText(row.title),
    original_file_name: fixMojibakeText(row.original_file_name),
    uploaded_by_name: fixMojibakeText(row.uploaded_by_name),
    parse_error: fixMojibakeText(row.parse_error),
  };
};

const sanitizeGenerateJobRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    bid_category: normalizeBidCategory(row.bid_category) || trimText(row.bid_category),
    source_file_name: fixMojibakeText(row.source_file_name),
    model_name: fixMojibakeText(row.model_name),
    operator_name: fixMojibakeText(row.operator_name),
    warning_text: fixMojibakeText(row.warning_text),
    error_message: fixMojibakeText(row.error_message),
  };
};

const sanitizeDocTemplateRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    template_no: fixMojibakeText(row.template_no),
    template_name: fixMojibakeText(row.template_name),
    original_file_name: fixMojibakeText(row.original_file_name),
    created_by_name: fixMojibakeText(row.created_by_name),
    updated_by_name: fixMojibakeText(row.updated_by_name),
  };
};

const buildSampleNo = async () => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `SP-${day}-`;
  const row = await get('SELECT COUNT(1) AS count FROM tender_bid_samples WHERE sample_no LIKE ?', [`${prefix}%`]);
  const seq = String(Number(row?.count || 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
};

const buildDocTemplateNo = async () => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `DT-${day}-`;
  const row = await get('SELECT COUNT(1) AS count FROM tender_doc_templates WHERE template_no LIKE ?', [`${prefix}%`]);
  const seq = String(Number(row?.count || 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
};

const normalizeAnalysisText = (value, maxLen = BID_ANALYZE_MAX_TEXT) => {
  const compact = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!compact) return '';
  return compact.slice(0, maxLen);
};

const toLines = (value) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((line) => trimText(line))
    .filter(Boolean);

const summarizeSectionText = (value, maxLen = 320) => {
  const text = normalizeAnalysisText(value, 24000);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
};

const findSectionStartIndex = (text, aliases = []) => {
  let best = -1;
  for (const alias of aliases) {
    if (!alias) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`(^|\\n)\\s*(第[一二三四五六七八九十0-9]+[章节部分条款项]\\s*)?${escaped}(\\s|\\n|$)`),
      new RegExp(`(^|\\n)\\s*[0-9一二三四五六七八九十]+[、\\.．]\\s*${escaped}(\\s|\\n|$)`),
      new RegExp(`(^|\\n)\\s*${escaped}(\\s|\\n|$)`),
    ];
    for (const pattern of patterns) {
      const matched = pattern.exec(text);
      if (!matched) continue;
      const idx = matched.index + (matched[1] ? matched[1].length : 0);
      if (best === -1 || idx < best) best = idx;
    }

    const looseIdx = text.indexOf(alias);
    if (looseIdx >= 0 && (best === -1 || looseIdx < best)) best = looseIdx;
  }
  return best;
};

const countLinesBeforeIndex = (text, index) => {
  const source = String(text || '');
  const end = Math.max(0, Math.min(Number(index) || 0, source.length));
  if (!end) return 1;
  let lines = 1;
  for (let i = 0; i < end; i += 1) {
    if (source.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
};

const splitTenderSections = (inputText) => {
  const text = normalizeAnalysisText(inputText, BID_ANALYZE_MAX_TEXT);
  const markers = [];
  for (const def of tenderSectionDefs) {
    const index = findSectionStartIndex(text, def.aliases);
    if (index >= 0) markers.push({ ...def, index });
  }

  markers.sort((a, b) => a.index - b.index);
  const sectionMap = {};
  const sectionList = [];

  if (!markers.length) {
    const summary = summarizeSectionText(text, 420);
    const totalLines = toLines(text).length || (text ? 1 : 0);
    for (const def of tenderSectionDefs) {
      const payload = {
        section_key: def.key,
        section_title: def.title,
        text: def.key === 'INVITATION' ? text : '',
        summary: def.key === 'INVITATION' ? summary : '',
        start_index: def.key === 'INVITATION' ? 0 : null,
        end_index: def.key === 'INVITATION' ? text.length : null,
        start_line: def.key === 'INVITATION' ? 1 : null,
        end_line: def.key === 'INVITATION' ? totalLines : null,
      };
      sectionMap[def.key] = payload;
      sectionList.push(payload);
    }
    return { sectionMap, sectionList };
  }

  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const start = current.index;
    const end = next ? next.index : text.length;
    const startLine = countLinesBeforeIndex(text, start);
    const endLine = countLinesBeforeIndex(text, Math.max(start, end));
    const block = normalizeAnalysisText(text.slice(start, end), 80000);
    const payload = {
      section_key: current.key,
      section_title: current.title,
      text: block,
      summary: summarizeSectionText(block, 420),
      start_index: start,
      end_index: end,
      start_line: startLine,
      end_line: endLine,
    };
    sectionMap[current.key] = payload;
  }

  for (const def of tenderSectionDefs) {
    const item = sectionMap[def.key] || {
      section_key: def.key,
      section_title: def.title,
      text: '',
      summary: '',
      start_index: null,
      end_index: null,
      start_line: null,
      end_line: null,
    };
    sectionMap[def.key] = item;
    sectionList.push(item);
  }

  return { sectionMap, sectionList };
};

const extractPlainTextTableBlocks = (inputText, options = {}) => {
  const maxTables = Math.max(1, Math.min(40, Number(options.maxTables || 20)));
  const maxRows = Math.max(1, Math.min(400, Number(options.maxRows || 160)));
  const maxCols = Math.max(2, Math.min(40, Number(options.maxCols || 16)));
  const lines = toLines(inputText);
  if (!lines.length) return [];

  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };

  for (const line of lines) {
    const hasPipe = line.includes('|') && line.split('|').filter((item) => trimText(item)).length >= 2;
    const hasTab = line.includes('\t') && line.split('\t').filter((item) => trimText(item)).length >= 2;
    if (hasPipe || hasTab) {
      current.push(line);
    } else {
      flush();
    }
  }
  flush();

  const tables = [];
  for (const group of groups) {
    if (tables.length >= maxTables) break;
    const rows = group
      .slice(0, maxRows)
      .map((line) => {
        const rawCells = line.includes('|') ? line.split('|') : line.split('\t');
        return rawCells
          .map((cell) => normalizeSearchText(cell, 200))
          .filter((cell, idx) => idx < maxCols)
          .map((cell) => cell || '未明确');
      })
      .filter((row) => row.some((cell) => trimText(cell) && trimText(cell) !== '未明确'));

    if (!rows.length) continue;
    const header = rows[0] || [];
    const body = rows.slice(1);
    const columnCount = rows.reduce((acc, row) => Math.max(acc, row.length), 0);
    const previewRows = rows.slice(0, 3).map((row) => row.join(' | ')).filter(Boolean);
    const mergedText = rows.flat().join(' ');
    tables.push({
      table_index: tables.length + 1,
      row_count: rows.length,
      column_count: columnCount,
      header,
      rows: body,
      summary: normalizeAnalysisText(previewRows.join('；'), 480),
      keywords: extractKeywords(mergedText, 16),
    });
  }

  return tables;
};

const tableKeywordGroups = {
  SCORE_TABLE: ['评分', '分值', '得分', '评审', '打分', '综合评分', '评分标准'],
  PRICE_TABLE: ['报价', '价格', '最高限价', '分项报价', '单价', '总价'],
  PERSONNEL_TABLE: ['项目经理', '负责人', '工程师', '驻场', '人员', '团队', '证书'],
  SLA_TABLE: ['响应时间', '恢复时间', '可用性', '故障处理', 'SLA', '服务级别'],
  RISK_TABLE: ['无效投标', '废标', '否决', '实质性', '不满足', '负偏离', '★', '▲'],
  CONTRACT_TABLE: ['违约责任', '扣款', '考核', '付款', '履约', '合同'],
};

const inferTableType = (table = {}) => {
  const merged = trimText([
    ...(Array.isArray(table.header) ? table.header : []),
    ...((Array.isArray(table.rows) ? table.rows : []).flat()),
    table.summary,
  ].join(' '));
  if (!merged) return 'GENERAL_TABLE';
  for (const [type, keywords] of Object.entries(tableKeywordGroups)) {
    if (keywords.some((key) => merged.includes(key))) return type;
  }
  return 'GENERAL_TABLE';
};

const findBestSectionForTable = (table = {}, sectionList = []) => {
  const keywords = Array.isArray(table.keywords) ? table.keywords.filter(Boolean).slice(0, 10) : [];
  const tableType = inferTableType(table);
  if (!keywords.length) {
    if (tableType === 'SCORE_TABLE') {
      return { section_key: 'SCORE_TABLE', section_title: '评分表' };
    }
    return { section_key: 'ATTACHMENT', section_title: '附件' };
  }

  let best = null;
  for (const section of sectionList) {
    const text = trimText(section?.text);
    if (!text) continue;
    let score = 0;
    for (const token of keywords) {
      if (token && text.includes(token)) score += 1;
    }
    if (!best || score > best.score) {
      best = {
        score,
        section_key: trimText(section?.section_key) || 'ATTACHMENT',
        section_title: trimText(section?.section_title) || '附件',
      };
    }
  }

  if (best && best.score > 0) return best;
  if (tableType === 'SCORE_TABLE') {
    return { section_key: 'SCORE_TABLE', section_title: '评分表' };
  }
  return { section_key: 'ATTACHMENT', section_title: '附件' };
};

const buildTableSummaries = ({ tables = [], sectionList = [] }) =>
  tables.map((table, idx) => {
    const located = findBestSectionForTable(table, sectionList);
    return {
      table_index: Number(table.table_index || idx + 1),
      table_type: inferTableType(table),
      section_key: located.section_key,
      section_title: located.section_title,
      row_count: Number(table.row_count || 0),
      column_count: Number(table.column_count || 0),
      header: Array.isArray(table.header) ? table.header : [],
      rows: Array.isArray(table.rows) ? table.rows.slice(0, 220) : [],
      summary: trimText(table.summary) || '未明确',
      keywords: Array.isArray(table.keywords) ? table.keywords.slice(0, 20) : [],
    };
  });

const wordStopList = new Set([
  '根据',
  '以及',
  '其中',
  '可以',
  '进行',
  '相关',
  '本项目',
  '项目',
  '投标',
  '招标',
  '采购',
  '内容',
  '文件',
  '要求',
  '条款',
  '标准',
  '合同',
  '附件',
  '格式',
  '规定',
  '单位',
  '工作',
  '服务',
  '必须',
  '不得',
]);

const extractKeywords = (value, limit = 40) => {
  const text = normalizeAnalysisText(value, 200000);
  if (!text) return [];
  const tokens = text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => trimText(token).toLowerCase())
    .filter((token) => token.length >= 2 && token.length <= 24 && !wordStopList.has(token));

  const score = new Map();
  for (const token of tokens) {
    score.set(token, Number(score.get(token) || 0) + 1);
  }
  return Array.from(score.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map((item) => item[0]);
};

const detectBidCategoryFromText = (text) => {
  const serviceWords = ['服务', '驻场', '运维', '维保', '咨询', '顾问', '实施服务', '技术服务', '培训服务'];
  const productWords = ['货物', '产品', '设备', '器材', '硬件', '采购清单', '品牌', '型号', '规格参数'];
  const serviceHit = serviceWords.reduce((acc, word) => (text.includes(word) ? acc + 1 : acc), 0);
  const productHit = productWords.reduce((acc, word) => (text.includes(word) ? acc + 1 : acc), 0);
  if (!serviceHit && !productHit) return '';
  if (serviceHit >= productHit) return 'SERVICE';
  return 'PRODUCT';
};

const detectBidFeatures = (inputText) => {
  const text = normalizeAnalysisText(inputText, BID_ANALYZE_MAX_TEXT);
  const keywords = extractKeywords(text, 50);

  const detectFeature = (candidates) => {
    for (const item of candidates) {
      if (item.words.some((word) => text.includes(word))) return item.name;
    }
    return '未识别';
  };

  const projectType = detectFeature([
    { name: '信息化建设', words: ['信息化', '系统集成', '平台建设', '软件开发'] },
    { name: '工程建设', words: ['工程', '施工', '监理', '造价'] },
    { name: '运维服务', words: ['运维', '驻场', '巡检', '保障服务'] },
    { name: '咨询服务', words: ['咨询', '顾问', '评估', '规划'] },
  ]);
  const industry = detectFeature([
    { name: '政府采购', words: ['政府采购', '财政', '公共资源交易', '采购人'] },
    { name: '教育行业', words: ['学校', '教育局', '学院', '校园'] },
    { name: '医疗行业', words: ['医院', '医疗', '卫健', '卫生健康'] },
    { name: '能源行业', words: ['电力', '能源', '燃气', '石化'] },
  ]);
  const procurementMode = detectFeature([
    { name: '公开招标', words: ['公开招标'] },
    { name: '竞争性磋商', words: ['竞争性磋商'] },
    { name: '竞争性谈判', words: ['竞争性谈判'] },
    { name: '询价采购', words: ['询价'] },
    { name: '单一来源', words: ['单一来源'] },
  ]);

  return {
    project_type: projectType,
    industry,
    procurement_mode: procurementMode,
    bid_category: detectBidCategoryFromText(text),
    keywords,
  };
};

const containsAny = (text, words) => words.some((word) => text.includes(word));

const buildRuleAnalyzeItems = ({ sectionList = [] }) => {
  const scoringWords = ['得分', '加分', '评分', '分值', '优秀', '优先', '能力', '业绩', '资质'];
  const riskWords = ['否决', '无效', '废标', '扣分', '不予', '不符合', '必须', '不得', '拒绝', '逾期', '未提供'];
  const highRiskWords = ['否决', '无效', '废标', '必须', '不得'];

  const scoring = [];
  const risks = [];
  const scoreDedup = new Set();
  const riskDedup = new Set();

  for (const section of sectionList) {
    const lines = toLines(section.text).slice(0, 300);
    for (const rawLine of lines) {
      const line = trimText(rawLine).replace(/^[-*•\d.、()\s]+/, '');
      if (!line || line.length < 8) continue;

      if (containsAny(line, scoringWords)) {
        const key = `${section.section_key}:${line.slice(0, 80)}`;
        if (!scoreDedup.has(key)) {
          scoreDedup.add(key);
          scoring.push({
            section_key: section.section_key,
            section_title: section.section_title,
            title: line.slice(0, 180),
            evidence: line.slice(0, 300),
            suggestion: '建议在投标文件中提供可核验的证明材料并对应评分条款逐条响应。',
          });
        }
      }

      if (containsAny(line, riskWords)) {
        const key = `${section.section_key}:${line.slice(0, 80)}`;
        if (!riskDedup.has(key)) {
          riskDedup.add(key);
          const riskLevel = containsAny(line, highRiskWords) ? 'HIGH' : 'MEDIUM';
          risks.push({
            section_key: section.section_key,
            section_title: section.section_title,
            title: line.slice(0, 180),
            evidence: line.slice(0, 300),
            suggestion: riskLevel === 'HIGH'
              ? '该条属于硬约束，需在成稿前逐条核对并补齐佐证。'
              : '建议在响应条款中补充说明，避免因细节缺失导致扣分。',
            risk_level: riskLevel,
          });
        }
      }
    }
  }

  return {
    scoring_items: scoring.slice(0, 200),
    risk_items: risks.slice(0, 200),
  };
};

const isUnclearText = (value) => {
  const text = trimText(value);
  return !text || text === '未明确';
};

const hasMeaningfulList = (value) =>
  Array.isArray(value) && value.some((item) => {
    const text = trimText(item);
    return text && text !== '未明确';
  });

const toClauseLines = (value) => {
  const source = String(value || '').replace(/\r\n/g, '\n');
  if (!trimText(source)) return [];
  const lines = source
    .split(/\n+/)
    .flatMap((line) => String(line || '').split(/[。；;！？!?]/u))
    .map((line) => trimText(line).replace(/^[-*•\d.、()\s]+/u, ''))
    .filter((line) => line.length >= 4);
  const dedup = [];
  const seen = new Set();
  for (const line of lines) {
    const clipped = line.length > 360 ? line.slice(0, 360) : line;
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    dedup.push(clipped);
  }
  return dedup;
};

const collectSectionClauseLines = (sectionList = [], sectionKeys = []) => {
  const keys = new Set((Array.isArray(sectionKeys) ? sectionKeys : []).map((item) => trimText(item).toUpperCase()).filter(Boolean));
  const rows = [];
  for (const section of Array.isArray(sectionList) ? sectionList : []) {
    const sectionKey = trimText(section?.section_key).toUpperCase();
    if (keys.size && !keys.has(sectionKey)) continue;
    rows.push(...toClauseLines(section?.text));
  }
  return rows;
};

const extractClauseMatches = ({ sectionList = [], sectionKeys = [], keywords = [], limit = 12, minLen = 6 }) => {
  const lines = collectSectionClauseLines(sectionList, sectionKeys);
  const words = (Array.isArray(keywords) ? keywords : []).map((item) => trimText(item)).filter(Boolean);
  if (!lines.length || !words.length) return [];
  const matched = [];
  const seen = new Set();
  for (const line of lines) {
    if (line.length < minLen) continue;
    if (!words.some((word) => line.includes(word))) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    matched.push(line);
    if (matched.length >= limit) break;
  }
  return matched;
};

const hasMeaningfulParamRows = (value) =>
  Array.isArray(value) && value.some((row) => {
    if (!isPlainObject(row)) return false;
    const requirement = trimText(row.param_requirement || row.param_name);
    return requirement && requirement !== '未明确';
  });

const hasMeaningfulServiceItems = (value) =>
  Array.isArray(value) && value.some((row) => {
    if (!isPlainObject(row)) return false;
    const scope = trimText(row.service_scope);
    const delivery = trimText(row.delivery_content);
    return (scope && scope !== '未明确') || (delivery && delivery !== '未明确');
  });

const hasMeaningfulSlaItems = (value) =>
  Array.isArray(value) && value.some((row) => {
    if (!isPlainObject(row)) return false;
    const requirement = trimText(row.indicator_requirement);
    return requirement && requirement !== '未明确';
  });

const enrichAnalyzeFinalJsonByRules = ({ finalJson = {}, sectionList = [], bidCategory = 'SERVICE' }) => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const next = normalizeFinalAnalyzeJson(finalJson, category);
  const changedFields = [];
  const productKeywords = resolveStageKeywordGroups('PRODUCT');
  const serviceKeywords = resolveStageKeywordGroups('SERVICE');
  const mark = (fieldPath) => {
    if (!changedFields.includes(fieldPath)) changedFields.push(fieldPath);
  };

  const setTextIfUnclear = (obj, key, value, fieldPath) => {
    const text = trimText(value);
    if (!text) return;
    if (isUnclearText(obj?.[key])) {
      obj[key] = text;
      mark(fieldPath);
    }
  };
  const setListIfEmpty = (obj, key, list, fieldPath) => {
    if (hasMeaningfulList(obj?.[key])) return;
    const rows = (Array.isArray(list) ? list : [])
      .map((item) => trimText(item))
      .filter((item) => item && item !== '未明确');
    if (!rows.length) return;
    obj[key] = Array.from(new Set(rows));
    mark(fieldPath);
  };

  const businessSourceKeys = ['CONTRACT_TERMS', 'BIDDER_INSTRUCTION_TABLE', 'BIDDER_INSTRUCTION', 'ATTACHMENT'];
  const documentSourceKeys = ['BID_DOC_FORMAT', 'BIDDER_INSTRUCTION_TABLE', 'BIDDER_INSTRUCTION', 'ATTACHMENT'];
  const business = isPlainObject(next.business_performance_rules) ? next.business_performance_rules : {};
  const docRules = isPlainObject(next.bid_document_production_rules) ? next.bid_document_production_rules : {};

  setTextIfUnclear(
    business,
    'payment_terms',
    extractClauseMatches({
      sectionList,
      sectionKeys: businessSourceKeys,
      keywords: ['付款', '支付', '结算', '发票', '价款'],
      limit: 1,
    })[0],
    'business_performance_rules.payment_terms'
  );
  setTextIfUnclear(
    business,
    'performance_bond_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: businessSourceKeys,
      keywords: ['履约保证', '履约保函', '保证金'],
      limit: 1,
    })[0],
    'business_performance_rules.performance_bond_rules'
  );
  setTextIfUnclear(
    business,
    'intellectual_property_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: businessSourceKeys,
      keywords: ['知识产权', '保密', '著作权', '商业秘密'],
      limit: 1,
    })[0],
    'business_performance_rules.intellectual_property_rules'
  );
  setTextIfUnclear(
    business,
    'liability_for_breach_of_contract',
    extractClauseMatches({
      sectionList,
      sectionKeys: businessSourceKeys,
      keywords: ['违约责任', '扣款', '罚款', '考核'],
      limit: 1,
    })[0],
    'business_performance_rules.liability_for_breach_of_contract'
  );
  setTextIfUnclear(
    business,
    'renewal_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: businessSourceKeys,
      keywords: ['续约', '续签', '延长', '展期'],
      limit: 1,
    })[0],
    'business_performance_rules.renewal_rules'
  );
  setListIfEmpty(
    business,
    'other_business_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: businessSourceKeys,
      keywords: [...serviceKeywords.contract, ...productKeywords.contract, ...serviceKeywords.price],
      limit: 10,
    }),
    'business_performance_rules.other_business_rules'
  );

  setListIfEmpty(
    docRules,
    'document_composition_list',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['投标文件', '组成', '格式', '目录', '清单', '应包含'],
      limit: 14,
    }),
    'bid_document_production_rules.document_composition_list'
  );
  setTextIfUnclear(
    docRules,
    'deviation_table_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['偏离表', '技术偏离', '商务偏离', '响应偏离'],
      limit: 1,
    })[0],
    'bid_document_production_rules.deviation_table_rules'
  );
  setTextIfUnclear(
    docRules,
    'file_format_requirements',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['文件格式', 'Word', 'PDF', '字体', '页码', '装订'],
      limit: 1,
    })[0],
    'bid_document_production_rules.file_format_requirements'
  );
  setTextIfUnclear(
    docRules,
    'copy_requirements',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['正本', '副本', '份数', '电子版', '光盘'],
      limit: 1,
    })[0],
    'bid_document_production_rules.copy_requirements'
  );
  setTextIfUnclear(
    docRules,
    'signature_seal_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['签字', '盖章', '签章', '骑缝章', '法定代表人'],
      limit: 1,
    })[0],
    'bid_document_production_rules.signature_seal_rules'
  );
  setTextIfUnclear(
    docRules,
    'sealing_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['密封', '封装', '封袋', '包装'],
      limit: 1,
    })[0],
    'bid_document_production_rules.sealing_rules'
  );
  setTextIfUnclear(
    docRules,
    'electronic_bid_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['电子投标', '加密', '解密', '上传', '电子签章'],
      limit: 1,
    })[0],
    'bid_document_production_rules.electronic_bid_rules'
  );
  setTextIfUnclear(
    docRules,
    'quotation_sheet_rules',
    extractClauseMatches({
      sectionList,
      sectionKeys: documentSourceKeys,
      keywords: ['报价一览表', '分项报价', '报价表', '报价清单'],
      limit: 1,
    })[0],
    'bid_document_production_rules.quotation_sheet_rules'
  );

  if (category === 'PRODUCT') {
    const detail = isPlainObject(next.goods_procurement_detail) ? next.goods_procurement_detail : {};
    const techSourceKeys = ['PROCUREMENT_REQUIREMENT', 'TECH_PARAM_TABLE', 'ATTACHMENT', 'CONTRACT_TERMS'];
    const paramLines = extractClauseMatches({
      sectionList,
      sectionKeys: ['TECH_PARAM_TABLE', 'PROCUREMENT_REQUIREMENT'],
      keywords: [...productKeywords.technical, '规格', '参数', '配置', '性能'],
      limit: 40,
    });

    setTextIfUnclear(
      detail,
      'delivery_period',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: ['交付周期', '交货期', '实施周期', '供货周期', '交货时间'],
        limit: 1,
      })[0],
      'goods_procurement_detail.delivery_period'
    );
    setTextIfUnclear(
      detail,
      'delivery_place',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: ['交付地点', '交货地点', '收货地点', '服务地点'],
        limit: 1,
      })[0],
      'goods_procurement_detail.delivery_place'
    );
    setListIfEmpty(
      detail,
      'implementation_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: ['实施', '安装', '调试', '部署', '供货', '交付'],
        limit: 12,
      }),
      'goods_procurement_detail.implementation_requirements'
    );
    setListIfEmpty(
      detail,
      'acceptance_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: ['验收', '测试', '开箱', '交接'],
        limit: 10,
      }),
      'goods_procurement_detail.acceptance_requirements'
    );
    setListIfEmpty(
      detail,
      'after_sales_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: ['售后', '质保', '维保', '保修', '故障响应'],
        limit: 10,
      }),
      'goods_procurement_detail.after_sales_requirements'
    );
    setListIfEmpty(
      detail,
      'manufacturer_authorization',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: productKeywords.authorization,
        limit: 8,
      }),
      'goods_procurement_detail.manufacturer_authorization'
    );
    setListIfEmpty(
      detail,
      'certification_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: productKeywords.certification,
        limit: 10,
      }),
      'goods_procurement_detail.certification_requirements'
    );
    setListIfEmpty(
      detail,
      'sample_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: productKeywords.sample,
        limit: 8,
      }),
      'goods_procurement_detail.sample_requirements'
    );
    setListIfEmpty(
      detail,
      'other_goods_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: techSourceKeys,
        keywords: [...productKeywords.technical, ...productKeywords.price, ...productKeywords.contract],
        limit: 12,
      }),
      'goods_procurement_detail.other_goods_requirements'
    );

    if (!hasMeaningfulParamRows(detail.core_mandatory_parameters) && paramLines.length) {
      const rows = [];
      for (const line of paramLines.slice(0, 30)) {
        const isMandatory = line.includes('★') || line.includes('▲') || line.includes('实质性') ? '是' : '否';
        const negativeInvalid = line.includes('负偏离') || line.includes('无效投标') || line.includes('废标') ? '是' : '否';
        rows.push({
          param_serial: String(rows.length + 1),
          param_name: `参数${rows.length + 1}`,
          param_requirement: line,
          is_mandatory: isMandatory,
          negative_deviation_invalid: negativeInvalid,
        });
      }
      const mandatoryRows = rows.filter((item) => item.is_mandatory === '是');
      if (mandatoryRows.length) {
        detail.core_mandatory_parameters = mandatoryRows;
        mark('goods_procurement_detail.core_mandatory_parameters');
      }
      const generalRows = rows.filter((item) => item.is_mandatory !== '是');
      if (!hasMeaningfulParamRows(detail.general_parameters) && generalRows.length) {
        detail.general_parameters = generalRows;
        mark('goods_procurement_detail.general_parameters');
      }
    }

    next.goods_procurement_detail = detail;
  } else {
    const detail = isPlainObject(next.service_procurement_detail) ? next.service_procurement_detail : {};
    const serviceSourceKeys = ['PROCUREMENT_REQUIREMENT', 'CONTRACT_TERMS', 'ATTACHMENT'];

    setTextIfUnclear(
      detail,
      'service_period',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['服务期限', '合同履行期限', '履约期限', '服务期'],
        limit: 1,
      })[0],
      'service_procurement_detail.service_period'
    );
    setTextIfUnclear(
      detail,
      'service_place',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['服务地点', '实施地点', '驻场地点', '工作地点'],
        limit: 1,
      })[0],
      'service_procurement_detail.service_place'
    );
    setTextIfUnclear(
      detail,
      'resident_requirement',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['驻场', '现场服务', '7*24', '7×24', '工作日驻场'],
        limit: 1,
      })[0],
      'service_procurement_detail.resident_requirement'
    );
    setListIfEmpty(
      detail,
      'service_implementation_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['实施', '流程', '计划', '进度', '服务方案'],
        limit: 12,
      }),
      'service_procurement_detail.service_implementation_requirements'
    );
    setListIfEmpty(
      detail,
      'quality_assurance_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['质量保障', '质量管理', '保密', '考核', '质控'],
        limit: 10,
      }),
      'service_procurement_detail.quality_assurance_requirements'
    );
    setListIfEmpty(
      detail,
      'emergency_response_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['应急', '故障', '突发', '恢复', '响应时间'],
        limit: 10,
      }),
      'service_procurement_detail.emergency_response_requirements'
    );
    setListIfEmpty(
      detail,
      'training_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['培训', '交底', '演练'],
        limit: 8,
      }),
      'service_procurement_detail.training_requirements'
    );
    setListIfEmpty(
      detail,
      'other_service_requirements',
      extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: [...serviceKeywords.technical, ...serviceKeywords.sla, ...serviceKeywords.personnel],
        limit: 12,
      }),
      'service_procurement_detail.other_service_requirements'
    );

    if (!hasMeaningfulServiceItems(detail.service_content_list)) {
      const rows = extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: ['服务内容', '服务范围', '工作内容', '采购标的', '需求'],
        limit: 10,
      }).map((line, idx) => ({
        item_serial: String(idx + 1),
        service_item_name: `服务项${idx + 1}`,
        service_scope: line,
        service_frequency: '未明确',
        delivery_content: '未明确',
        is_mandatory: line.includes('★') || line.includes('▲') || line.includes('实质性') ? '是' : '否',
        negative_deviation_invalid: line.includes('负偏离') || line.includes('无效投标') || line.includes('废标') ? '是' : '否',
      }));
      if (rows.length) {
        detail.service_content_list = rows;
        mark('service_procurement_detail.service_content_list');
      }
    }
    if (!hasMeaningfulSlaItems(detail.core_sla_indicators)) {
      const rows = extractClauseMatches({
        sectionList,
        sectionKeys: serviceSourceKeys,
        keywords: serviceKeywords.sla,
        limit: 10,
      }).map((line, idx) => ({
        indicator_serial: String(idx + 1),
        indicator_name: `SLA指标${idx + 1}`,
        indicator_requirement: line,
        is_mandatory: line.includes('★') || line.includes('▲') || line.includes('实质性') ? '是' : '否',
        negative_deviation_invalid: line.includes('负偏离') || line.includes('无效投标') || line.includes('废标') ? '是' : '否',
      }));
      if (rows.length) {
        detail.core_sla_indicators = rows;
        mark('service_procurement_detail.core_sla_indicators');
      }
    }
    next.service_procurement_detail = detail;
  }

  next.business_performance_rules = business;
  next.bid_document_production_rules = docRules;

  return {
    final_json: normalizeFinalAnalyzeJson(next, category),
    filled_count: changedFields.length,
    filled_fields: changedFields,
  };
};

const extractSampleKeywordsFromSections = (sections = []) => {
  const merged = sections.map((item) => item?.text || '').join('\n');
  return extractKeywords(merged, 60);
};

const buildSampleFeatureRows = (sampleId, features = {}) => {
  const list = [];
  const pushFeature = (key, value, weight = 1) => {
    const text = trimText(value);
    if (!text || text === '未识别') return;
    list.push({
      sample_id: sampleId,
      feature_key: key,
      feature_value: text,
      feature_weight: Number(weight),
    });
  };

  pushFeature('project_type', features.project_type, 2.2);
  pushFeature('industry', features.industry, 1.8);
  pushFeature('procurement_mode', features.procurement_mode, 2.0);
  pushFeature('bid_category', normalizeBidCategory(features.bid_category), 2.4);
  const keywords = Array.isArray(features.keywords) ? features.keywords.slice(0, 30) : [];
  for (const word of keywords) {
    pushFeature('keyword', word, 0.2);
  }
  return list;
};

const rankMatchedSamples = ({ analyzeFeatures, analyzeSections, samples }) => {
  const targetKeywords = new Set(Array.isArray(analyzeFeatures?.keywords) ? analyzeFeatures.keywords : []);
  const targetSectionCount = (analyzeSections || []).filter((item) => trimText(item?.text)).length || 1;
  const targetProjectType = trimText(analyzeFeatures?.project_type);
  const targetIndustry = trimText(analyzeFeatures?.industry);
  const targetMode = trimText(analyzeFeatures?.procurement_mode);
  const targetBidCategory = normalizeBidCategory(analyzeFeatures?.bid_category);

  const scored = [];
  for (const sample of samples) {
    const sampleKeywords = Array.isArray(sample.keywords) ? sample.keywords : [];
    const sampleKeywordSet = new Set(sampleKeywords);
    const sampleBidCategory = normalizeBidCategory(sample.bid_category);
    let overlap = 0;
    for (const token of targetKeywords) {
      if (sampleKeywordSet.has(token)) overlap += 1;
    }

    const sectionCount = Number(sample.section_count || 0);
    const sectionCoverage = Math.min(1, sectionCount / targetSectionCount);

    let featureScore = 0;
    if (targetProjectType && targetProjectType === trimText(sample.project_type)) featureScore += 0.32;
    if (targetIndustry && targetIndustry === trimText(sample.industry)) featureScore += 0.24;
    if (targetMode && targetMode === trimText(sample.procurement_mode)) featureScore += 0.24;
    if (targetBidCategory && targetBidCategory === sampleBidCategory) featureScore += 0.36;
    if (targetBidCategory && sampleBidCategory && targetBidCategory !== sampleBidCategory) featureScore -= 0.12;

    const keywordScore = targetKeywords.size ? Math.min(1, overlap / targetKeywords.size) : 0;
    const total = Number(Math.max(0, keywordScore * 0.44 + featureScore + sectionCoverage * 0.12).toFixed(4));
    const reasonParts = [];
    if (targetBidCategory && targetBidCategory === sampleBidCategory) {
      reasonParts.push(`招标类型匹配：${bidCategoryLabel(targetBidCategory)}`);
    } else if (targetBidCategory && sampleBidCategory && targetBidCategory !== sampleBidCategory) {
      reasonParts.push(`招标类型不同：样本为${bidCategoryLabel(sampleBidCategory)}`);
    }
    if (targetProjectType && targetProjectType === trimText(sample.project_type)) reasonParts.push(`项目类型匹配：${targetProjectType}`);
    if (targetIndustry && targetIndustry === trimText(sample.industry)) reasonParts.push(`行业匹配：${targetIndustry}`);
    if (targetMode && targetMode === trimText(sample.procurement_mode)) reasonParts.push(`采购方式匹配：${targetMode}`);
    if (overlap > 0) reasonParts.push(`关键词重合 ${overlap} 项`);
    reasonParts.push(`章节覆盖 ${sectionCount}/${targetSectionCount}`);

    scored.push({
      sample_id: Number(sample.id),
      sample_no: sample.sample_no,
      title: sample.title,
      original_file_name: sample.original_file_name,
      score: total,
      reason: reasonParts.join('，'),
    });
  }

  return scored.sort((a, b) => b.score - a.score || a.sample_id - b.sample_id);
};

const textByExtFromStorage = async ({ sourcePath, sourceExt, maxLen = BID_ANALYZE_MAX_TEXT }) => {
  const extRaw = trimText(sourceExt || path.extname(sourcePath)).toLowerCase();
  const ext = extRaw.startsWith('.') ? extRaw : `.${extRaw}`;
  if (!trimText(sourcePath)) return '';
  if (ext === '.docx') {
    return normalizeAnalysisText(await extractDocxSearchText(sourcePath), maxLen);
  }

  if (ext === '.doc' || ext === '.pdf') {
    const tempDir = path.join(EDITABLE_ROOT, `parse-${Date.now()}-${crypto.randomUUID()}`);
    let convertedPath = '';
    try {
      convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'docx');
      return normalizeAnalysisText(await extractDocxSearchText(convertedPath), maxLen);
    } finally {
      if (convertedPath) await deleteFileSafe(convertedPath);
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  return '';
};

const tablesByExtFromStorage = async ({ sourcePath, sourceExt, sourceText = '' }) => {
  const extRaw = trimText(sourceExt || path.extname(sourcePath)).toLowerCase();
  const ext = extRaw.startsWith('.') ? extRaw : `.${extRaw}`;
  if (!trimText(sourcePath)) return [];

  if (ext === '.docx') {
    const docxTables = await extractDocxTableBlocks(sourcePath, { maxTables: 50, maxRows: 220, maxCols: 20 });
    if (docxTables.length) return docxTables;
    return extractPlainTextTableBlocks(sourceText, { maxTables: 30, maxRows: 180, maxCols: 16 });
  }

  if (ext === '.doc' || ext === '.pdf') {
    const tempDir = path.join(EDITABLE_ROOT, `parse-table-${Date.now()}-${crypto.randomUUID()}`);
    let convertedPath = '';
    try {
      convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'docx');
      const docxTables = await extractDocxTableBlocks(convertedPath, { maxTables: 50, maxRows: 220, maxCols: 20 });
      if (docxTables.length) return docxTables;
      return extractPlainTextTableBlocks(sourceText, { maxTables: 30, maxRows: 180, maxCols: 16 });
    } finally {
      if (convertedPath) await deleteFileSafe(convertedPath);
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  return [];
};

const composeAnalysisSummary = ({ sections, tables, scoringItems, riskItems, warnings = [] }) => ({
  section_count: Array.isArray(sections) ? sections.length : 0,
  table_count: Array.isArray(tables) ? tables.length : 0,
  scoring_count: Array.isArray(scoringItems) ? scoringItems.length : 0,
  risk_count: Array.isArray(riskItems) ? riskItems.length : 0,
  warning_count: Array.isArray(warnings) ? warnings.length : 0,
});

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const createServiceFinalAnalyzeSchema = () => ({
  project_core_info: {
    project_full_name: '未明确',
    project_code: '未明确',
    government_procurement_code: '未明确',
    project_type: '服务类',
    service_category: '未明确',
    procurement_mode: '未明确',
    buyer_full_name: '未明确',
    buyer_contact: '未明确',
    agency_full_name: '未明确',
    agency_contact: '未明确',
    fund_source: '未明确',
    project_budget: '未明确',
    max_bid_price: '未明确',
    bid_validity_days: '未明确',
    bid_file_get_time: '未明确',
    bid_submission_deadline: '未明确',
    bid_opening_time: '未明确',
    bid_opening_place: '未明确',
    bid_submission_mode: '未明确',
    consortium_allowed: '未明确',
    consortium_requirements: ['未明确'],
  },
  bidder_qualification_requirements: {
    main_body_qualification: ['未明确'],
    industry_access_qualification: ['未明确'],
    system_certification_requirements: ['未明确'],
    financial_requirements: ['未明确'],
    performance_requirements: ['未明确'],
    credit_requirements: ['未明确'],
    other_qualification: ['未明确'],
  },
  invalid_bid_full_clauses: {
    qualification_invalid_clauses: ['未明确'],
    compliance_invalid_clauses: ['未明确'],
    personnel_invalid_clauses: ['未明确'],
    service_scheme_invalid_clauses: ['未明确'],
    sla_invalid_clauses: ['未明确'],
    business_invalid_clauses: ['未明确'],
    quotation_invalid_clauses: ['未明确'],
    signature_seal_invalid_clauses: ['未明确'],
    other_invalid_clauses: ['未明确'],
  },
  service_procurement_detail: {
    service_period: '未明确',
    service_place: '未明确',
    resident_requirement: '未明确',
    service_content_list: [
      {
        item_serial: '未明确',
        service_item_name: '未明确',
        service_scope: '未明确',
        service_frequency: '未明确',
        delivery_content: '未明确',
        is_mandatory: '否',
        negative_deviation_invalid: '否',
      },
    ],
    core_sla_indicators: [
      {
        indicator_serial: '未明确',
        indicator_name: '未明确',
        indicator_requirement: '未明确',
        is_mandatory: '否',
        negative_deviation_invalid: '否',
      },
    ],
    core_personnel_requirements: [
      {
        position_serial: '未明确',
        position_name: '未明确',
        required_number: '未明确',
        certificate_requirements: ['未明确'],
        experience_requirements: ['未明确'],
        other_requirements: ['未明确'],
        is_mandatory: '否',
        non_compliance_invalid: '否',
      },
    ],
    service_implementation_requirements: ['未明确'],
    quality_assurance_requirements: ['未明确'],
    emergency_response_requirements: ['未明确'],
    training_requirements: ['未明确'],
    acceptance_rules: {
      acceptance_stage: '未明确',
      acceptance_standard: '未明确',
      acceptance_delivery: '未明确',
    },
    other_service_requirements: ['未明确'],
  },
  evaluation_full_criteria: {
    evaluation_method: '未明确',
    total_full_score: '未明确',
    price_score_rules: {
      full_score: '未明确',
      score_calculation_formula: '未明确',
      price_deduction_policy: ['未明确'],
    },
    technical_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
        risk_level: '中',
        bid_response_module: '未明确',
        response_required_materials: ['未明确'],
      },
    ],
    personnel_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
        risk_level: '中',
        bid_response_module: '未明确',
        response_required_materials: ['未明确'],
      },
    ],
    business_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
        risk_level: '中',
        bid_response_module: '未明确',
        response_required_materials: ['未明确'],
      },
    ],
    policy_preference_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
      },
    ],
  },
  business_performance_rules: {
    payment_terms: '未明确',
    performance_bond_rules: '未明确',
    intellectual_property_rules: '未明确',
    liability_for_breach_of_contract: '未明确',
    renewal_rules: '未明确',
    other_business_rules: ['未明确'],
  },
  bid_document_production_rules: {
    document_composition_list: ['未明确'],
    deviation_table_rules: '未明确',
    file_format_requirements: '未明确',
    copy_requirements: '未明确',
    signature_seal_rules: '未明确',
    sealing_rules: '未明确',
    electronic_bid_rules: '未明确',
    quotation_sheet_rules: '未明确',
  },
  bid_self_inspection_list: {
    high_risk_check_items: ['未明确'],
    medium_risk_check_items: ['未明确'],
    low_risk_check_items: ['未明确'],
  },
  other_key_notes: ['未明确'],
});

const createProductFinalAnalyzeSchema = () => ({
  project_core_info: {
    project_full_name: '未明确',
    project_code: '未明确',
    government_procurement_code: '未明确',
    project_type: '产品类',
    goods_category: '未明确',
    procurement_mode: '未明确',
    buyer_full_name: '未明确',
    buyer_contact: '未明确',
    agency_full_name: '未明确',
    agency_contact: '未明确',
    fund_source: '未明确',
    project_budget: '未明确',
    max_bid_price: '未明确',
    bid_validity_days: '未明确',
    bid_file_get_time: '未明确',
    bid_submission_deadline: '未明确',
    bid_opening_time: '未明确',
    bid_opening_place: '未明确',
    bid_submission_mode: '未明确',
    consortium_allowed: '未明确',
    consortium_requirements: ['未明确'],
  },
  bidder_qualification_requirements: {
    main_body_qualification: ['未明确'],
    industry_access_qualification: ['未明确'],
    system_certification_requirements: ['未明确'],
    financial_requirements: ['未明确'],
    performance_requirements: ['未明确'],
    credit_requirements: ['未明确'],
    other_qualification: ['未明确'],
  },
  mandatory_clause_list: ['未明确'],
  invalid_bid_full_clauses: {
    qualification_invalid_clauses: ['未明确'],
    compliance_invalid_clauses: ['未明确'],
    personnel_invalid_clauses: ['未明确'],
    service_scheme_invalid_clauses: ['未明确'],
    sla_invalid_clauses: ['未明确'],
    business_invalid_clauses: ['未明确'],
    quotation_invalid_clauses: ['未明确'],
    signature_seal_invalid_clauses: ['未明确'],
    other_invalid_clauses: ['未明确'],
  },
  goods_procurement_detail: {
    delivery_period: '未明确',
    delivery_place: '未明确',
    core_mandatory_parameters: [
      {
        param_serial: '未明确',
        param_name: '未明确',
        param_requirement: '未明确',
        is_mandatory: '否',
        negative_deviation_invalid: '否',
      },
    ],
    general_parameters: [
      {
        param_serial: '未明确',
        param_name: '未明确',
        param_requirement: '未明确',
        is_mandatory: '否',
        negative_deviation_invalid: '否',
      },
    ],
    manufacturer_authorization: ['未明确'],
    certification_requirements: ['未明确'],
    sample_requirements: ['未明确'],
    implementation_requirements: ['未明确'],
    acceptance_requirements: ['未明确'],
    after_sales_requirements: ['未明确'],
    other_goods_requirements: ['未明确'],
  },
  core_product_info: {
    core_product_name: '未明确',
    same_brand_rule: '未明确',
    rule_description: '未明确',
  },
  evaluation_full_criteria: {
    evaluation_method: '未明确',
    total_full_score: '未明确',
    price_score_rules: {
      full_score: '未明确',
      score_calculation_formula: '未明确',
      price_deduction_policy: ['未明确'],
    },
    technical_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
        risk_level: '中',
        bid_response_module: '技术参数响应',
        response_required_materials: ['未明确'],
      },
    ],
    personnel_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
        risk_level: '中',
        bid_response_module: '团队与人员响应',
        response_required_materials: ['未明确'],
      },
    ],
    business_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
        risk_level: '中',
        bid_response_module: '商务响应',
        response_required_materials: ['未明确'],
      },
    ],
    policy_preference_score_items: [
      {
        item_serial: '未明确',
        score_item_name: '未明确',
        full_score: '未明确',
        scoring_standard: '未明确',
      },
    ],
  },
  evaluation_score_matrix: [
    {
      score_category: '未明确',
      score_item_name: '未明确',
      full_score: '未明确',
      scoring_standard: '未明确',
      risk_level: '中',
      bid_response_module: '未明确',
      response_required_materials: ['未明确'],
    },
  ],
  technical_deviation_table: [
    {
      param_serial: '未明确',
      param_name: '未明确',
      tender_requirement: '未明确',
      bid_response: '未明确',
      deviation: '无偏离',
    },
  ],
  business_performance_rules: {
    payment_terms: '未明确',
    performance_bond_rules: '未明确',
    intellectual_property_rules: '未明确',
    liability_for_breach_of_contract: '未明确',
    renewal_rules: '未明确',
    other_business_rules: ['未明确'],
  },
  bid_document_production_rules: {
    document_composition_list: ['未明确'],
    deviation_table_rules: '未明确',
    file_format_requirements: '未明确',
    copy_requirements: '未明确',
    signature_seal_rules: '未明确',
    sealing_rules: '未明确',
    electronic_bid_rules: '未明确',
    quotation_sheet_rules: '未明确',
  },
  bid_self_inspection_list: {
    high_risk_check_items: ['未明确'],
    medium_risk_check_items: ['未明确'],
    low_risk_check_items: ['未明确'],
  },
  other_key_notes: ['未明确'],
});

const createFinalAnalyzeSchema = (bidCategory = 'SERVICE') => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  return category === 'PRODUCT' ? createProductFinalAnalyzeSchema() : createServiceFinalAnalyzeSchema();
};

const normalizeStringOrUnclear = (value, fallback = '未明确') => trimText(value) || fallback;

const normalizeStringArray = (value, fallback = '未明确') => {
  if (!Array.isArray(value)) return [fallback];
  const seen = new Set();
  const rows = [];
  for (const item of value) {
    const text = trimText(item);
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    rows.push(text);
  }
  return rows.length ? rows : [fallback];
};

const mergeBySchema = (schema, input) => {
  if (typeof schema === 'string') return normalizeStringOrUnclear(input, schema || '未明确');
  if (Array.isArray(schema)) {
    if (schema.length === 1 && typeof schema[0] === 'string') {
      return normalizeStringArray(input, schema[0] || '未明确');
    }
    if (schema.length === 1 && isPlainObject(schema[0])) {
      if (!Array.isArray(input)) return [];
      const rows = input
        .filter((item) => isPlainObject(item))
        .map((item) => mergeBySchema(schema[0], item));
      return rows.length ? rows : [];
    }
    if (!Array.isArray(input)) return [];
    return input;
  }
  if (!isPlainObject(schema)) return schema;
  const source = isPlainObject(input) ? input : {};
  const output = {};
  for (const key of Object.keys(schema)) {
    output[key] = mergeBySchema(schema[key], source[key]);
  }
  return output;
};

const normalizeProductEvaluationScoreMatrix = (finalJson = {}) => {
  const matrixRows = Array.isArray(finalJson?.evaluation_score_matrix) ? finalJson.evaluation_score_matrix : [];
  const listRows = [];
  const push = (row) => {
    const normalized = {
      score_category: normalizeStringOrUnclear(row?.score_category),
      score_item_name: normalizeStringOrUnclear(row?.score_item_name),
      full_score: normalizeStringOrUnclear(row?.full_score),
      scoring_standard: normalizeStringOrUnclear(row?.scoring_standard),
      risk_level: normalizeStringOrUnclear(row?.risk_level, '中'),
      bid_response_module: normalizeStringOrUnclear(row?.bid_response_module),
      response_required_materials: normalizeStringArray(row?.response_required_materials, '未明确'),
    };
    listRows.push(normalized);
  };

  for (const row of matrixRows) {
    if (!isPlainObject(row)) continue;
    if (!trimText(row.score_item_name) || trimText(row.score_item_name) === '未明确') continue;
    push(row);
  }

  const groups = [
    { key: 'technical_score_items', label: '技术分' },
    { key: 'personnel_score_items', label: '人员分' },
    { key: 'business_score_items', label: '商务分' },
    { key: 'policy_preference_score_items', label: '政策加分' },
  ];
  for (const group of groups) {
    const rows = Array.isArray(finalJson?.evaluation_full_criteria?.[group.key])
      ? finalJson.evaluation_full_criteria[group.key]
      : [];
    for (const item of rows) {
      if (!isPlainObject(item) || !trimText(item.score_item_name) || trimText(item.score_item_name) === '未明确') continue;
      push({
        score_category: group.label,
        score_item_name: item.score_item_name,
        full_score: item.full_score,
        scoring_standard: item.scoring_standard,
        risk_level: item.risk_level,
        bid_response_module: item.bid_response_module,
        response_required_materials: item.response_required_materials,
      });
    }
  }

  const dedup = new Set();
  const uniqueRows = listRows.filter((item) => {
    const key = `${trimText(item.score_category)}::${trimText(item.score_item_name)}::${trimText(item.scoring_standard)}`;
    if (!trimText(item.score_item_name) || dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });
  return uniqueRows.length ? uniqueRows : createProductFinalAnalyzeSchema().evaluation_score_matrix;
};

const normalizeProductTechnicalDeviationTable = (finalJson = {}) => {
  const inputRows = Array.isArray(finalJson?.technical_deviation_table) ? finalJson.technical_deviation_table : [];
  const normalizedRows = [];
  for (const row of inputRows) {
    if (!isPlainObject(row)) continue;
    const requirement = trimText(row.tender_requirement || row.param_requirement || row.param_name);
    if (!requirement || requirement === '未明确') continue;
    normalizedRows.push({
      param_serial: normalizeStringOrUnclear(row.param_serial),
      param_name: normalizeStringOrUnclear(row.param_name),
      tender_requirement: normalizeStringOrUnclear(row.tender_requirement || row.param_requirement),
      bid_response: normalizeStringOrUnclear(row.bid_response || row.bidder_response),
      deviation: normalizeStringOrUnclear(row.deviation || row.deviation_note, '无偏离'),
    });
  }

  if (normalizedRows.length) return normalizedRows;
  const detail = isPlainObject(finalJson?.goods_procurement_detail) ? finalJson.goods_procurement_detail : {};
  const core = Array.isArray(detail.core_mandatory_parameters) ? detail.core_mandatory_parameters : [];
  const general = Array.isArray(detail.general_parameters) ? detail.general_parameters : [];
  for (const row of [...core, ...general]) {
    if (!isPlainObject(row)) continue;
    const requirement = trimText(row.param_requirement || row.param_name);
    if (!requirement || requirement === '未明确') continue;
    normalizedRows.push({
      param_serial: normalizeStringOrUnclear(row.param_serial),
      param_name: normalizeStringOrUnclear(row.param_name),
      tender_requirement: normalizeStringOrUnclear(row.param_requirement || row.param_name),
      bid_response: '已响应，详见技术参数响应表',
      deviation: '无偏离',
    });
  }

  return normalizedRows.length ? normalizedRows : createProductFinalAnalyzeSchema().technical_deviation_table;
};

const normalizeFinalAnalyzeJson = (raw, bidCategory = 'SERVICE') => {
  const source = isPlainObject(raw?.final_json) ? raw.final_json : (isPlainObject(raw) ? raw : {});
  const inferred = normalizeBidCategory(bidCategory)
    || normalizeBidCategory(source?.project_core_info?.project_type)
    || 'SERVICE';
  const schema = createFinalAnalyzeSchema(inferred);
  const normalized = mergeBySchema(schema, source);
  if (normalized?.project_core_info) {
    normalized.project_core_info.project_type = bidCategoryLabel(inferred);
  }
  if (inferred === 'PRODUCT') {
    normalized.evaluation_score_matrix = normalizeProductEvaluationScoreMatrix(normalized);
    normalized.technical_deviation_table = normalizeProductTechnicalDeviationTable(normalized);
  }
  return normalized;
};

const buildRequiredChapterScan = (sectionList = []) =>
  REQUIRED_ANALYZE_CHAPTERS.map((def) => {
    const matched = sectionList.find((item) => trimText(item?.section_key) === def.key && trimText(item?.text));
    const hit = !!matched;
    return {
      chapter_key: def.key,
      chapter_title: def.title,
      chapter_status: hit ? '已定位' : '未找到',
      start_line: Number.isFinite(Number(matched?.start_line)) ? Number(matched.start_line) : null,
      end_line: Number.isFinite(Number(matched?.end_line)) ? Number(matched.end_line) : null,
    };
  });

const estimatePageNumberByLine = (lineNo) => {
  const parsed = Number(lineNo);
  if (!Number.isFinite(parsed) || parsed <= 0) return '未明确';
  return String(Math.max(1, Math.floor((parsed - 1) / ANALYZE_ESTIMATED_LINES_PER_PAGE) + 1));
};

const tokenizeEvidenceNeedles = (value, limit = 12) => {
  const base = trimText(value);
  if (!base || base === '未明确') return [];
  const tokens = [];
  const push = (token) => {
    const text = trimText(token);
    if (!text) return;
    if (tokens.includes(text)) return;
    tokens.push(text);
  };

  push(base.slice(0, 96));
  const words = base
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .map((item) => trimText(item))
    .filter((item) => item.length >= 2 && item.length <= 24)
    .sort((a, b) => b.length - a.length);
  for (const word of words) {
    push(word);
    if (tokens.length >= limit) break;
  }
  return tokens.slice(0, limit);
};

const buildSourceReferenceFromSection = ({ section, lineIndex = 0, excerpt = '', fallbackChapter = '未明确' }) => {
  const startLine = Number.isFinite(Number(section?.start_line)) ? Number(section.start_line) : 1;
  const lineNumber = Math.max(1, startLine + Math.max(0, Number(lineIndex) || 0));
  const chapter = trimText(section?.section_title) || fallbackChapter || '未明确';
  return {
    chapter,
    page_number: estimatePageNumberByLine(lineNumber),
    line_number: String(lineNumber),
    excerpt: trimText(excerpt).slice(0, 360) || '未明确',
  };
};

const locateSourceReference = ({ sectionList = [], preferredChapter = '', primaryText = '', secondaryText = '', fallbackChapter = '未明确' }) => {
  const sections = Array.isArray(sectionList) ? sectionList : [];
  const chapter = trimText(preferredChapter);
  const needles = [
    ...tokenizeEvidenceNeedles(primaryText, 10),
    ...tokenizeEvidenceNeedles(secondaryText, 6),
  ].filter(Boolean);

  const chapterFirst = chapter
    ? sections.filter((item) => trimText(item?.section_title) === chapter || trimText(item?.section_key) === chapter)
    : [];
  const candidates = [...chapterFirst, ...sections.filter((item) => !chapterFirst.includes(item))];

  for (const section of candidates) {
    const lines = toLines(section?.text).slice(0, 1800);
    if (!lines.length) continue;
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = trimText(lines[idx]);
      if (!line) continue;
      if (!needles.length || needles.some((needle) => needle && line.includes(needle))) {
        return buildSourceReferenceFromSection({
          section,
          lineIndex: idx,
          excerpt: line,
          fallbackChapter: chapter || fallbackChapter,
        });
      }
    }
  }

  const fallbackSection = candidates.find((item) => trimText(item?.text))
    || sections.find((item) => trimText(item?.text));
  if (fallbackSection) {
    const excerpt = toLines(fallbackSection.text)[0] || primaryText || secondaryText || '未明确';
    return buildSourceReferenceFromSection({
      section: fallbackSection,
      lineIndex: 0,
      excerpt,
      fallbackChapter: chapter || fallbackChapter,
    });
  }

  return {
    chapter: chapter || fallbackChapter || '未明确',
    page_number: '未明确',
    line_number: '未明确',
    excerpt: trimText(primaryText || secondaryText).slice(0, 360) || '未明确',
  };
};

const enrichStage1RiskClausesBySource = (rows = [], sectionList = []) =>
  normalizeStage1RiskClauses(rows).map((item) => {
    const resolved = locateSourceReference({
      sectionList,
      preferredChapter: trimText(item?.source_reference?.chapter),
      primaryText: trimText(item?.clause_content),
      secondaryText: trimText(item?.trigger_keyword),
      fallbackChapter: '风险条款',
    });
    return {
      ...item,
      source_reference: {
        chapter: trimText(item?.source_reference?.chapter) || resolved.chapter,
        page_number: trimText(item?.source_reference?.page_number) || resolved.page_number,
        line_number: trimText(item?.source_reference?.line_number) || resolved.line_number,
        excerpt: trimText(item?.source_reference?.excerpt) || resolved.excerpt,
      },
    };
  });

const enrichStage3MissingItemsBySource = (rows = [], sectionList = []) =>
  normalizeStage3MissingItems(rows).map((item) => {
    const resolved = locateSourceReference({
      sectionList,
      preferredChapter: trimText(item?.source_reference?.chapter),
      primaryText: trimText(item?.missing_content),
      secondaryText: trimText(item?.item_type),
      fallbackChapter: '交叉校验',
    });
    return {
      ...item,
      source_reference: {
        chapter: trimText(item?.source_reference?.chapter) || resolved.chapter,
        page_number: trimText(item?.source_reference?.page_number) || resolved.page_number,
        line_number: trimText(item?.source_reference?.line_number) || resolved.line_number,
        excerpt: trimText(item?.source_reference?.excerpt) || resolved.excerpt,
      },
    };
  });

const enrichGenerateItemsBySource = (rows = [], sectionList = []) =>
  (Array.isArray(rows) ? rows : []).map((item) => {
    const resolved = locateSourceReference({
      sectionList,
      preferredChapter: trimText(item?.section_title || item?.section_key),
      primaryText: trimText(item?.evidence || item?.title),
      secondaryText: trimText(item?.title),
      fallbackChapter: trimText(item?.section_title) || '未明确',
    });
    return {
      ...item,
      source_reference: resolved,
    };
  });

const buildAnalyzeQualityGate = ({
  sourceText = '',
  requiredChapterScan = [],
  tableSummaries = [],
  stage1RiskClauses = [],
  scoreExtract = {},
  productParamExtract = {},
  bidCategory = 'SERVICE',
  preflightOnly = false,
}) => {
  const textCharCount = String(sourceText || '').length;
  const chapterRows = Array.isArray(requiredChapterScan) ? requiredChapterScan : [];
  const chapterHitCount = chapterRows.filter((row) => trimText(row?.chapter_status) === '已定位').length;
  const chapterTotalCount = chapterRows.length || REQUIRED_ANALYZE_CHAPTERS.length;
  const chapterCoverage = chapterTotalCount > 0 ? Number((chapterHitCount / chapterTotalCount).toFixed(4)) : 0;
  const chapterKeywordHitCount = REQUIRED_ANALYZE_CHAPTERS.filter((def) => {
    const title = trimText(def?.title);
    return title && String(sourceText || '').includes(title);
  }).length;
  const tableCount = Array.isArray(tableSummaries) ? tableSummaries.length : 0;
  const scoreTableDetected = (Array.isArray(tableSummaries) ? tableSummaries : []).some((item) => {
    const sectionKey = trimText(item?.section_key).toUpperCase();
    const tableType = trimText(item?.table_type).toUpperCase();
    const summary = trimText(item?.summary);
    return sectionKey === 'SCORE_TABLE'
      || tableType === 'SCORE_TABLE'
      || summary.includes('评分')
      || summary.includes('分值');
  });
  const productParamTableDetected = (Array.isArray(tableSummaries) ? tableSummaries : []).some((item) => isLikelyProductParamTable(item));
  const mergedScoreCount = Number(scoreExtract?.merged_total_count || scoreExtract?.merged_count || 0);
  const mergedParamCount = Number(productParamExtract?.table_param_merged_count || 0);
  const riskClauseCount = Array.isArray(stage1RiskClauses) ? stage1RiskClauses.length : 0;
  const normalizedCategory = normalizeBidCategory(bidCategory) || 'SERVICE';

  const blockingIssues = [];
  const warningIssues = [];

  if (textCharCount < ANALYZE_MIN_TEXT_LENGTH) {
    blockingIssues.push(`可解析文本长度不足（当前${textCharCount}字，至少需要${ANALYZE_MIN_TEXT_LENGTH}字）`);
  }
  if (chapterHitCount < ANALYZE_MIN_STRUCTURED_CHAPTER_HITS && tableCount === 0 && chapterKeywordHitCount < ANALYZE_MIN_STRUCTURED_CHAPTER_HITS) {
    blockingIssues.push(`章节识别不足（结构命中${chapterHitCount}/${chapterTotalCount}，章节关键词命中${chapterKeywordHitCount}，且未识别到有效表格）`);
  }
  if (!preflightOnly && scoreTableDetected && mergedScoreCount <= 0) {
    blockingIssues.push('检测到评分表，但未逐条提取评分项');
  }

  if (chapterCoverage < 0.35 && chapterTotalCount > 0) {
    warningIssues.push(`章节识别覆盖率较低（${chapterHitCount}/${chapterTotalCount}）`);
  }
  if (!preflightOnly && riskClauseCount <= 0) {
    warningIssues.push('未识别到风险条款，请人工复核废标/无效/实质性条款');
  }
  if (!preflightOnly && normalizedCategory === 'PRODUCT' && productParamTableDetected && mergedParamCount <= 0) {
    warningIssues.push('检测到技术参数表，但未提取到结构化参数，请人工复核');
  }

  const status = blockingIssues.length ? 'BLOCK' : (warningIssues.length ? 'WARN' : 'PASS');
  return {
    status,
    allow_generate: status !== 'BLOCK',
    checks: {
      text_char_count: textCharCount,
      required_chapter_hit_count: chapterHitCount,
      required_chapter_total: chapterTotalCount,
      required_chapter_coverage: chapterCoverage,
      required_chapter_keyword_hit_count: chapterKeywordHitCount,
      table_count: tableCount,
      score_table_detected: scoreTableDetected ? 1 : 0,
      score_items_merged_count: mergedScoreCount,
      product_param_table_detected: productParamTableDetected ? 1 : 0,
      product_param_merged_count: mergedParamCount,
      risk_clause_count: riskClauseCount,
      bid_category: normalizedCategory,
    },
    blocking_issues: blockingIssues.length ? blockingIssues : ['无'],
    warning_issues: warningIssues.length ? warningIssues : ['无'],
  };
};

const normalizeStage1RiskClauses = (raw) => {
  if (!Array.isArray(raw)) return [];
  const dedup = new Set();
  const rows = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!isPlainObject(item)) continue;
    const clauseContent = trimText(item.clause_content || item.missing_content);
    if (!clauseContent) continue;
    const clauseTypeRaw = trimText(item.clause_type).toUpperCase();
    const clauseType = RISK_CLAUSE_TYPE_SET.has(clauseTypeRaw) ? clauseTypeRaw : 'OTHER_INVALID';
    const chapter = trimText(item?.source_reference?.chapter);
    const pageNumber = trimText(item?.source_reference?.page_number);
    const lineNumber = trimText(item?.source_reference?.line_number);
    const excerpt = trimText(item?.source_reference?.excerpt);
    const key = `${clauseType}::${clauseContent}::${chapter}::${pageNumber}::${lineNumber}::${excerpt}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    rows.push({
      evidence_id: trimText(item.evidence_id) || `RISK-${String(i + 1).padStart(4, '0')}`,
      clause_type: clauseType,
      clause_content: clauseContent,
      trigger_keyword: trimText(item.trigger_keyword) || '未明确',
      risk_level: trimText(item.risk_level) === '中' ? '中' : '高',
      source_reference: {
        chapter: chapter || '未明确',
        page_number: pageNumber || '未明确',
        line_number: lineNumber || '未明确',
        excerpt: excerpt || clauseContent.slice(0, 180) || '未明确',
      },
    });
  }
  return rows;
};

const inferClauseTypeByKeywords = (line, sectionKey, bidCategory = 'SERVICE') => {
  const text = trimText(line);
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const groups = resolveStageKeywordGroups(category);
  if (!text) return 'OTHER_INVALID';
  if ((groups.price || []).some((key) => text.includes(key))) return 'QUOTATION_INVALID';
  if ((groups.personnel || []).some((key) => text.includes(key))) return 'PERSONNEL_INVALID';
  if ((groups.contract || []).some((key) => text.includes(key))) return 'BUSINESS_INVALID';
  if ((groups.sla || []).some((key) => text.includes(key))) return 'SLA_INVALID';
  if ((groups.technical || []).some((key) => text.includes(key))) return 'COMPLIANCE_INVALID';
  if ((groups.authorization || []).some((key) => text.includes(key))) return 'QUALIFICATION_INVALID';
  if ((groups.certification || []).some((key) => text.includes(key))) return 'QUALIFICATION_INVALID';
  if ((groups.sample || []).some((key) => text.includes(key))) return 'COMPLIANCE_INVALID';
  if (trimText(sectionKey) === 'CONTRACT_TERMS') return 'BUSINESS_INVALID';
  if (trimText(sectionKey) === 'SCORING_STANDARD' || trimText(sectionKey) === 'SCORE_TABLE') return 'COMPLIANCE_INVALID';
  return 'OTHER_INVALID';
};

const scanRiskClausesByKeywords = (sectionList = [], bidCategory = 'SERVICE') => {
  const groups = resolveStageKeywordGroups(bidCategory);
  const allKeywords = [
    ...STAGE1_FORCE_KEYWORDS,
    ...(groups.sla || []),
    ...(groups.personnel || []),
    ...(groups.price || []),
    ...(groups.contract || []),
    ...(groups.technical || []),
    ...(groups.authorization || []),
    ...(groups.certification || []),
    ...(groups.sample || []),
  ];
  const rows = [];
  for (const section of sectionList) {
    const sectionKey = trimText(section?.section_key);
    const sectionTitle = trimText(section?.section_title) || '未明确';
    const lines = toLines(section?.text).slice(0, 600);
    for (const lineRaw of lines) {
      const line = trimText(lineRaw).replace(/^[-*•\d.、()\s]+/, '');
      if (!line || line.length < 6) continue;
      const hitKeyword = allKeywords.find((key) => line.includes(key));
      if (!hitKeyword) continue;
      rows.push({
        evidence_id: '',
        clause_type: inferClauseTypeByKeywords(line, sectionKey, bidCategory),
        clause_content: line.slice(0, 500),
        trigger_keyword: hitKeyword,
        risk_level: '高',
        source_reference: {
          chapter: sectionTitle,
          page_number: '未明确',
        },
      });
    }
  }
  return normalizeStage1RiskClauses(rows);
};

const normalizeStage3MissingItems = (raw) => {
  if (!Array.isArray(raw)) return [];
  const dedup = new Set();
  const rows = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const itemTypeRaw = trimText(item.item_type).toUpperCase();
    const itemType = MISSING_ITEM_TYPE_SET.has(itemTypeRaw) ? itemTypeRaw : '';
    const missingContent = trimText(item.missing_content);
    if (!itemType || !missingContent) continue;
    const chapter = trimText(item?.source_reference?.chapter) || '未明确';
    const pageNumber = trimText(item?.source_reference?.page_number) || '未明确';
    const lineNumber = trimText(item?.source_reference?.line_number) || '未明确';
    const excerpt = trimText(item?.source_reference?.excerpt) || missingContent.slice(0, 180) || '未明确';
    const key = `${itemType}::${missingContent}::${chapter}::${pageNumber}::${lineNumber}::${excerpt}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    rows.push({
      item_type: itemType,
      target_field_path: trimText(item.target_field_path),
      missing_content: missingContent,
      source_reference: {
        chapter,
        page_number: pageNumber,
        line_number: lineNumber,
        excerpt,
      },
    });
  }
  return rows;
};

const countKeywordCoverage = ({ sectionList = [], keywords = [] }) => {
  const normalizedKeywords = Array.isArray(keywords)
    ? keywords.map((item) => trimText(item)).filter(Boolean)
    : [];
  if (!normalizedKeywords.length) {
    return {
      hit_count: 0,
      hit_keywords: [],
      hit_examples: [],
    };
  }

  const keywordSet = new Set();
  const hitExamples = [];

  for (const section of (Array.isArray(sectionList) ? sectionList : [])) {
    const lines = toLines(section?.text).slice(0, 1200);
    if (!lines.length) continue;
    for (const line of lines) {
      for (const keyword of normalizedKeywords) {
        if (!line.includes(keyword)) continue;
        keywordSet.add(keyword);
        if (hitExamples.length < 6) {
          hitExamples.push({
            keyword,
            chapter: trimText(section?.section_title) || '未明确',
            excerpt: line.slice(0, 220),
          });
        }
      }
    }
  }

  return {
    hit_count: keywordSet.size,
    hit_keywords: Array.from(keywordSet),
    hit_examples: hitExamples,
  };
};

const buildRuleCoverageSummary = ({
  sectionList = [],
  bidCategory = 'SERVICE',
  stage1RiskClauses = [],
  scoreExtract = {},
}) => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const groups = resolveStageKeywordGroups(category);
  const forceRiskCoverage = countKeywordCoverage({
    sectionList,
    keywords: STAGE1_FORCE_KEYWORDS,
  });
  const quotationCoverage = countKeywordCoverage({
    sectionList,
    keywords: groups.price || [],
  });
  const personnelCoverage = countKeywordCoverage({
    sectionList,
    keywords: groups.personnel || [],
  });
  const slaOrTechCoverage = countKeywordCoverage({
    sectionList,
    keywords: category === 'PRODUCT' ? (groups.technical || []) : (groups.sla || []),
  });
  const scoringCoverage = countKeywordCoverage({
    sectionList,
    keywords: ['评分项', '评分标准', '评标办法', '综合评分法', '得分', '分值'],
  });

  const summaryItems = [
    { item_type: 'INVALID_BID_CLAUSE', label: '废标/无效条款', coverage: forceRiskCoverage },
    { item_type: 'QUOTATION_RULE', label: '报价规则', coverage: quotationCoverage },
    { item_type: 'PERSONNEL_REQUIREMENT', label: '人员要求', coverage: personnelCoverage },
    {
      item_type: category === 'PRODUCT' ? 'TECH_PARAMETER' : 'SLA_INDICATOR',
      label: category === 'PRODUCT' ? '技术参数' : 'SLA指标',
      coverage: slaOrTechCoverage,
    },
    { item_type: 'SCORING_ITEM', label: '评分项', coverage: scoringCoverage },
  ];

  const missingItems = [];
  for (const item of summaryItems) {
    const coverage = item.coverage || { hit_count: 0, hit_keywords: [] };
    if (Number(coverage.hit_count || 0) > 0) continue;
    missingItems.push({
      item_type: item.item_type,
      target_field_path: '',
      missing_content: `${item.label}未命中关键词，请人工复核该类条款`,
      source_reference: {
        chapter: '未明确',
        page_number: '未明确',
        line_number: '未明确',
        excerpt: `关键词：${(Array.isArray(coverage.hit_keywords) && coverage.hit_keywords.length
          ? coverage.hit_keywords
          : (item.item_type === 'SCORING_ITEM' ? ['评分项', '评分标准'] : [])).join('、') || '未明确'}`,
      },
    });
  }

  const stage1Count = Array.isArray(stage1RiskClauses) ? stage1RiskClauses.length : 0;
  if (stage1Count <= 0) {
    missingItems.push({
      item_type: 'INVALID_BID_CLAUSE',
      target_field_path: '',
      missing_content: '风险条款扫描结果为空，请人工复核废标/无效/否决条款',
      source_reference: {
        chapter: '风险扫描',
        page_number: '未明确',
        line_number: '未明确',
        excerpt: `命中关键词数：${forceRiskCoverage.hit_count}`,
      },
    });
  }

  const mergedScoreCount = Number(scoreExtract?.merged_total_count || scoreExtract?.merged_count || 0);
  if (Number(scoringCoverage.hit_count || 0) > 0 && mergedScoreCount <= 0) {
    missingItems.push({
      item_type: 'SCORING_ITEM',
      target_field_path: '',
      missing_content: '存在评分条款关键词但未形成结构化评分项，请人工复核评分表',
      source_reference: {
        chapter: '评分表',
        page_number: '未明确',
        line_number: '未明确',
        excerpt: `评分关键词命中：${scoringCoverage.hit_keywords.join('、') || '未明确'}`,
      },
    });
  }

  return {
    categories: summaryItems.map((item) => ({
      item_type: item.item_type,
      label: item.label,
      hit_count: Number(item.coverage?.hit_count || 0),
      hit_keywords: Array.isArray(item.coverage?.hit_keywords) ? item.coverage.hit_keywords : [],
      hit_examples: Array.isArray(item.coverage?.hit_examples) ? item.coverage.hit_examples : [],
    })),
    missing_items: normalizeStage3MissingItems(missingItems),
  };
};

const cloneJson = (value) => parseMaybeJson(JSON.stringify(value || {}), {});

const pushUniqueText = (list, value) => {
  const text = trimText(value);
  const current = Array.isArray(list) ? list : [];
  const filtered = current
    .map((item) => trimText(item))
    .filter((item) => item && item !== '未明确');
  if (text && !filtered.includes(text)) filtered.push(text);
  return filtered.length ? filtered : ['未明确'];
};

const mergeAnalyzeFinalJson = ({ stage2FinalJson, stage1RiskClauses = [], stage3MissingItems = [], bidCategory = 'SERVICE' }) => {
  const normalizedBidCategory = normalizeBidCategory(bidCategory) || 'SERVICE';
  const schema = createFinalAnalyzeSchema(normalizedBidCategory);
  const merged = cloneJson(stage2FinalJson);
  if (!isPlainObject(merged.bid_self_inspection_list)) merged.bid_self_inspection_list = {};
  if (!isPlainObject(merged.invalid_bid_full_clauses)) merged.invalid_bid_full_clauses = {};
  if (!isPlainObject(merged.service_procurement_detail)) merged.service_procurement_detail = {};
  if (!isPlainObject(merged.goods_procurement_detail)) merged.goods_procurement_detail = {};
  if (!isPlainObject(merged.bidder_qualification_requirements)) merged.bidder_qualification_requirements = {};
  if (!Array.isArray(merged.other_key_notes)) merged.other_key_notes = [];
  const invalid = isPlainObject(merged.invalid_bid_full_clauses) ? merged.invalid_bid_full_clauses : {};
  for (const item of stage1RiskClauses) {
    const targetKey = RISK_CLAUSE_TARGET_MAP[item.clause_type] || 'other_invalid_clauses';
    invalid[targetKey] = pushUniqueText(invalid[targetKey], item.clause_content);
  }
  merged.invalid_bid_full_clauses = mergeBySchema(schema.invalid_bid_full_clauses, invalid);

  const addMissingToList = (pathKey, value) => {
    if (pathKey === 'bid_self_inspection_list.high_risk_check_items') {
      merged.bid_self_inspection_list.high_risk_check_items = pushUniqueText(merged.bid_self_inspection_list.high_risk_check_items, value);
      return;
    }
    if (pathKey === 'service_procurement_detail.other_service_requirements') {
      if (normalizedBidCategory === 'PRODUCT') {
        merged.goods_procurement_detail.other_goods_requirements = pushUniqueText(merged.goods_procurement_detail.other_goods_requirements, value);
      } else {
        merged.service_procurement_detail.other_service_requirements = pushUniqueText(merged.service_procurement_detail.other_service_requirements, value);
      }
      return;
    }
    if (pathKey === 'goods_procurement_detail.other_goods_requirements') {
      if (normalizedBidCategory === 'PRODUCT') {
        merged.goods_procurement_detail.other_goods_requirements = pushUniqueText(merged.goods_procurement_detail.other_goods_requirements, value);
      } else {
        merged.service_procurement_detail.other_service_requirements = pushUniqueText(merged.service_procurement_detail.other_service_requirements, value);
      }
      return;
    }
    if (pathKey === 'invalid_bid_full_clauses.other_invalid_clauses') {
      merged.invalid_bid_full_clauses.other_invalid_clauses = pushUniqueText(merged.invalid_bid_full_clauses.other_invalid_clauses, value);
      return;
    }
    merged.other_key_notes = pushUniqueText(merged.other_key_notes, value);
  };

  for (const item of stage3MissingItems) {
    const targetFieldPath = trimText(item.target_field_path);
    if (targetFieldPath) {
      addMissingToList(targetFieldPath, item.missing_content);
      continue;
    }
    if (item.item_type === 'INVALID_BID_CLAUSE') {
      addMissingToList('invalid_bid_full_clauses.other_invalid_clauses', item.missing_content);
    } else if (item.item_type === 'SUBSTANTIVE_REQUIREMENT') {
      addMissingToList('bid_self_inspection_list.high_risk_check_items', item.missing_content);
    } else if (item.item_type === 'SLA_INDICATOR' || item.item_type === 'TECH_PARAMETER') {
      addMissingToList('service_procurement_detail.other_service_requirements', item.missing_content);
    } else if (item.item_type === 'AUTH_REQUIREMENT') {
      merged.bidder_qualification_requirements.other_qualification = pushUniqueText(
        merged.bidder_qualification_requirements.other_qualification,
        item.missing_content
      );
    } else if (item.item_type === 'CERTIFICATION_REQUIREMENT') {
      merged.bidder_qualification_requirements.system_certification_requirements = pushUniqueText(
        merged.bidder_qualification_requirements.system_certification_requirements,
        item.missing_content
      );
    } else if (item.item_type === 'SAMPLE_REQUIREMENT') {
      addMissingToList('goods_procurement_detail.other_goods_requirements', item.missing_content);
    } else {
      addMissingToList('', item.missing_content);
    }
  }

  return normalizeFinalAnalyzeJson(merged, normalizedBidCategory);
};

const scoreItemHeaderWords = new Set([
  '序号',
  '评分项',
  '评分项目',
  '评审项',
  '评审项目',
  '评审内容',
  '评分内容',
  '评分因素',
  '评分标准',
  '分值',
  '满分',
  '得分',
]);

const inferScoreItemGroup = (name, standard) => {
  const text = `${trimText(name)} ${trimText(standard)}`;
  if (!text) return 'technical_score_items';
  const personnelWords = ['人员', '团队', '项目经理', '负责人', '工程师', '驻场', '社保', '证书'];
  const businessWords = ['商务', '业绩', '资质', '企业', '履约', '报价', '价格'];
  const policyWords = ['中小企业', '节能', '环保', '残疾人', '监狱企业', '政策'];
  if (personnelWords.some((word) => text.includes(word))) return 'personnel_score_items';
  if (policyWords.some((word) => text.includes(word))) return 'policy_preference_score_items';
  if (businessWords.some((word) => text.includes(word))) return 'business_score_items';
  return 'technical_score_items';
};

const inferResponseModuleByName = (name, standard) => {
  const text = `${trimText(name)} ${trimText(standard)}`;
  if (['技术参数', '参数', '核心产品', '主要产品', '原厂授权', '样品', '样机'].some((word) => text.includes(word))) {
    return '技术参数响应';
  }
  if (['项目经理', '负责人', '工程师', '团队', '人员'].some((word) => text.includes(word))) {
    return '项目团队配置';
  }
  if (['业绩', '资质', '商务', '履约', '报价', '价格'].some((word) => text.includes(word))) {
    return '商务响应与证明材料';
  }
  if (['应急', '故障', '恢复', 'SLA', '可用性'].some((word) => text.includes(word))) {
    return '服务保障与应急方案';
  }
  return '服务实施方案';
};

const inferRiskLevelByScoreText = (name, standard) => {
  const text = `${trimText(name)} ${trimText(standard)}`;
  if (['★', '▲', '实质性', '否决', '无效', '废标', '不满足'].some((word) => text.includes(word))) return '高';
  if (['必须', '应当', '不得'].some((word) => text.includes(word))) return '中';
  return '中';
};

const parseScoreValueFromCells = (cells = []) => {
  let fallback = null;
  for (const cellRaw of cells) {
    const cell = trimText(cellRaw);
    if (!cell) continue;
    const withUnit = cell.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s*分/);
    if (withUnit) {
      const val = Number(withUnit[1]);
      if (Number.isFinite(val) && val >= 0 && val <= 1000) return String(val);
    }
    const pure = cell.match(/^([0-9]{1,3}(?:\.[0-9]+)?)$/);
    if (pure) {
      const val = Number(pure[1]);
      if (Number.isFinite(val) && val >= 0 && val <= 1000 && fallback === null) fallback = String(val);
    }
  }
  return fallback || '未明确';
};

const pickScoreItemNameFromCells = (cells = []) => {
  for (const cellRaw of cells) {
    const cell = trimText(cellRaw);
    if (!cell) continue;
    if (scoreItemHeaderWords.has(cell)) continue;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(cell)) continue;
    if (/^第?[一二三四五六七八九十0-9]+[项条]?$/.test(cell)) continue;
    return cell;
  }
  return '';
};

const buildScoreItemsFromTableSummaries = (tableSummaries = []) => {
  const rows = [];
  const dedup = new Set();
  for (const table of (Array.isArray(tableSummaries) ? tableSummaries : [])) {
    const sourceRows = [];
    if (Array.isArray(table?.rows)) {
      for (const row of table.rows) {
        if (Array.isArray(row)) sourceRows.push(row);
      }
    }
    for (let idx = 0; idx < sourceRows.length; idx += 1) {
      const cells = sourceRows[idx].map((cell) => trimText(cell)).filter((cell) => cell);
      if (!cells.length) continue;
      const mergedLine = cells.join(' | ');
      const hasScoreWord = ['评分', '得分', '分值', '满分', '评审'].some((word) => mergedLine.includes(word));
      const hasScoreNumber = cells.some((cell) => /([0-9]{1,3}(?:\.[0-9]+)?)\s*分/.test(cell) || /^[0-9]{1,3}(?:\.[0-9]+)?$/.test(cell));
      if (!hasScoreWord && !hasScoreNumber) continue;

      const itemName = pickScoreItemNameFromCells(cells);
      if (!itemName) continue;
      const scoringStandard = normalizeAnalysisText(cells.slice(1).join('；') || mergedLine, 500);
      const scoreKey = `${itemName}::${scoringStandard}`;
      if (dedup.has(scoreKey)) continue;
      dedup.add(scoreKey);

      const fullScore = parseScoreValueFromCells(cells);
      rows.push({
        group_key: inferScoreItemGroup(itemName, scoringStandard),
        item: {
          item_serial: `${Number(table?.table_index || 0) || 1}-${idx + 1}`,
          score_item_name: itemName,
          full_score: fullScore,
          scoring_standard: scoringStandard || '未明确',
          risk_level: inferRiskLevelByScoreText(itemName, scoringStandard),
          bid_response_module: inferResponseModuleByName(itemName, scoringStandard),
          response_required_materials: ['未明确'],
        },
      });
    }
  }
  return rows;
};

const buildScoreItemsFromRuleRows = (ruleRows = []) => {
  const rows = [];
  const dedup = new Set();
  for (let idx = 0; idx < (Array.isArray(ruleRows) ? ruleRows.length : 0); idx += 1) {
    const row = ruleRows[idx];
    const itemName = trimText(row?.title);
    if (!itemName || itemName === '未明确') continue;
    const scoringStandard = trimText(row?.evidence || row?.evidence_text) || '未明确';
    const key = `${itemName}::${scoringStandard}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    rows.push({
      group_key: inferScoreItemGroup(itemName, scoringStandard),
      item: {
        item_serial: `R-${idx + 1}`,
        score_item_name: itemName,
        full_score: '未明确',
        scoring_standard: scoringStandard,
        risk_level: trimText(row?.risk_level || '中').toUpperCase() === 'HIGH' ? '高' : '中',
        bid_response_module: inferResponseModuleByName(itemName, scoringStandard),
        response_required_materials: ['未明确'],
      },
    });
  }
  return rows;
};

const productParamHeaderWords = ['序号', '参数', '参数名称', '指标', '技术要求', '规格', '要求', '响应'];

const isLikelyProductParamTable = (table = {}) => {
  const sectionKey = trimText(table?.section_key).toUpperCase();
  if (sectionKey === 'TECH_PARAM_TABLE' || sectionKey === 'PROCUREMENT_REQUIREMENT') return true;
  const title = `${trimText(table?.section_title)} ${trimText(table?.table_name)}`;
  if (['技术参数', '参数表', '技术指标', '规格参数', '采购需求'].some((word) => title.includes(word))) return true;
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const first = Array.isArray(rows[0]) ? rows[0].map((cell) => trimText(cell)).join(' ') : '';
  return ['参数', '技术', '指标', '规格'].some((word) => first.includes(word));
};

const buildProductParametersFromTableSummaries = (tableSummaries = []) => {
  const rows = [];
  const dedup = new Set();
  for (const table of (Array.isArray(tableSummaries) ? tableSummaries : [])) {
    if (!isLikelyProductParamTable(table)) continue;
    const sourceRows = Array.isArray(table?.rows) ? table.rows.filter((item) => Array.isArray(item)) : [];
    if (!sourceRows.length) continue;

    for (let idx = 0; idx < sourceRows.length; idx += 1) {
      const cells = sourceRows[idx].map((cell) => trimText(cell)).filter((cell) => cell);
      if (cells.length < 2) continue;
      const mergedLine = cells.join(' | ');
      const looksHeader = cells.every((cell) => productParamHeaderWords.some((word) => cell.includes(word)));
      if (looksHeader) continue;

      let serial = '';
      let name = '';
      let requirement = '';
      if (/^(?:\d+|[一二三四五六七八九十]+)[\.\-、]?$/.test(cells[0])) {
        serial = cells[0];
        name = trimText(cells[1]);
        requirement = trimText(cells.slice(2).join('；') || cells[1]);
      } else if (cells.length >= 3) {
        serial = `${Number(table?.table_index || 0) || 1}-${idx + 1}`;
        name = trimText(cells[0]);
        requirement = trimText(cells.slice(1).join('；'));
      } else {
        serial = `${Number(table?.table_index || 0) || 1}-${idx + 1}`;
        name = trimText(cells[0]);
        requirement = trimText(cells[1]);
      }

      if (!name || name === '未明确') continue;
      if (!requirement || requirement === '未明确') continue;
      if (['参数名称', '技术要求', '规格', '指标', '要求'].some((word) => `${name}${requirement}`.includes(word)) && idx === 0) continue;

      const isMandatory = ['★', '▲', '*', '实质性', '必须', '不满足'].some((word) => mergedLine.includes(word));
      const negativeInvalid = ['负偏离无效', '负偏离作废标处理', '不满足作无效投标处理', '不满足作废标处理'].some((word) => mergedLine.includes(word));
      const key = `${name}::${requirement}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      rows.push({
        param_serial: serial || `${Number(table?.table_index || 0) || 1}-${idx + 1}`,
        param_name: name,
        param_requirement: requirement,
        is_mandatory: isMandatory ? '是' : '否',
        negative_deviation_invalid: negativeInvalid ? '是' : '否',
      });
    }
  }
  return rows;
};

const mergeProductParametersIntoFinalJson = ({ finalJson = {}, tableSummaries = [] }) => {
  const extractedRows = buildProductParametersFromTableSummaries(tableSummaries);
  const source = normalizeFinalAnalyzeJson(finalJson, 'PRODUCT');
  const detail = isPlainObject(source?.goods_procurement_detail) ? source.goods_procurement_detail : {};
  const coreExisting = Array.isArray(detail.core_mandatory_parameters)
    ? detail.core_mandatory_parameters.filter((item) => trimText(item?.param_requirement) && trimText(item?.param_requirement) !== '未明确')
    : [];
  const generalExisting = Array.isArray(detail.general_parameters)
    ? detail.general_parameters.filter((item) => trimText(item?.param_requirement) && trimText(item?.param_requirement) !== '未明确')
    : [];

  const dedup = new Set();
  for (const item of [...coreExisting, ...generalExisting]) {
    dedup.add(`${trimText(item.param_name)}::${trimText(item.param_requirement)}`);
  }

  let mergedCount = 0;
  for (const item of extractedRows) {
    const key = `${trimText(item.param_name)}::${trimText(item.param_requirement)}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    if (trimText(item.is_mandatory) === '是' || trimText(item.negative_deviation_invalid) === '是') {
      coreExisting.push(item);
    } else {
      generalExisting.push(item);
    }
    mergedCount += 1;
  }

  detail.core_mandatory_parameters = coreExisting.length
    ? coreExisting
    : createProductFinalAnalyzeSchema().goods_procurement_detail.core_mandatory_parameters;
  detail.general_parameters = generalExisting.length
    ? generalExisting
    : createProductFinalAnalyzeSchema().goods_procurement_detail.general_parameters;
  source.goods_procurement_detail = mergeBySchema(createProductFinalAnalyzeSchema().goods_procurement_detail, detail);

  return {
    final_json: normalizeFinalAnalyzeJson(source, 'PRODUCT'),
    table_param_extracted_count: extractedRows.length,
    table_param_merged_count: mergedCount,
  };
};

const mergeScoreItemsIntoFinalJson = ({ finalJson = {}, tableSummaries = [], ruleScoringItems = [], bidCategory = 'SERVICE' }) => {
  const normalizedBidCategory = normalizeBidCategory(bidCategory) || 'SERVICE';
  const source = cloneJson(finalJson);
  const criteria = isPlainObject(source?.evaluation_full_criteria) ? source.evaluation_full_criteria : {};
  const schemaCriteria = createFinalAnalyzeSchema(normalizedBidCategory).evaluation_full_criteria;
  const groupKeys = ['technical_score_items', 'personnel_score_items', 'business_score_items', 'policy_preference_score_items'];
  const mergedByGroup = {};
  const dedup = new Set();

  for (const key of groupKeys) {
    const list = Array.isArray(criteria?.[key]) ? criteria[key] : [];
    mergedByGroup[key] = list
      .filter((item) => isPlainObject(item) && trimText(item.score_item_name) && trimText(item.score_item_name) !== '未明确')
      .map((item) => ({
        item_serial: normalizeStringOrUnclear(item.item_serial),
        score_item_name: normalizeStringOrUnclear(item.score_item_name),
        full_score: normalizeStringOrUnclear(item.full_score),
        scoring_standard: normalizeStringOrUnclear(item.scoring_standard),
        risk_level: normalizeStringOrUnclear(item.risk_level, '中'),
        bid_response_module: normalizeStringOrUnclear(item.bid_response_module),
        response_required_materials: normalizeStringArray(item.response_required_materials, '未明确'),
      }));
    for (const item of mergedByGroup[key]) {
      dedup.add(`${item.score_item_name}::${item.scoring_standard}`);
    }
  }

  const tableItems = buildScoreItemsFromTableSummaries(tableSummaries);
  const fallbackRuleItems = buildScoreItemsFromRuleRows(ruleScoringItems);
  const candidateItems = [...tableItems, ...fallbackRuleItems];
  let tableMergedCount = 0;
  let fallbackMergedCount = 0;

  for (let i = 0; i < candidateItems.length; i += 1) {
    const candidate = candidateItems[i];
    const groupKey = groupKeys.includes(candidate.group_key) ? candidate.group_key : 'technical_score_items';
    const item = candidate.item;
    const dedupKey = `${trimText(item.score_item_name)}::${trimText(item.scoring_standard)}`;
    if (!trimText(item.score_item_name) || dedup.has(dedupKey)) continue;
    dedup.add(dedupKey);
    mergedByGroup[groupKey].push(item);
    if (i < tableItems.length) tableMergedCount += 1;
    else fallbackMergedCount += 1;
  }

  for (const key of groupKeys) {
    criteria[key] = mergedByGroup[key].length ? mergedByGroup[key] : schemaCriteria[key];
  }
  source.evaluation_full_criteria = mergeBySchema(schemaCriteria, criteria);

  return {
    final_json: normalizeFinalAnalyzeJson(source, normalizedBidCategory),
    table_extracted_count: tableItems.length,
    fallback_extracted_count: fallbackRuleItems.length,
    merged_count: tableMergedCount,
    fallback_merged_count: fallbackMergedCount,
    merged_total_count: tableMergedCount + fallbackMergedCount,
  };
};

const buildScoringItemsFromFinalJson = (finalJson) => {
  const criteria = finalJson?.evaluation_full_criteria || {};
  const matrix = Array.isArray(finalJson?.evaluation_score_matrix) ? finalJson.evaluation_score_matrix : [];
  const groups = [
    ...(Array.isArray(criteria.technical_score_items) ? criteria.technical_score_items : []),
    ...(Array.isArray(criteria.personnel_score_items) ? criteria.personnel_score_items : []),
    ...(Array.isArray(criteria.business_score_items) ? criteria.business_score_items : []),
    ...(Array.isArray(criteria.policy_preference_score_items) ? criteria.policy_preference_score_items : []),
  ];
  const seen = new Set();
  const rows = [];
  for (const item of matrix) {
    const title = trimText(item?.score_item_name);
    const scoringStandard = trimText(item?.scoring_standard);
    const key = `${title}::${scoringStandard}`;
    if (!title || title === '未明确' || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      section_key: 'SCORING_STANDARD',
      section_title: '评标方法与评标标准',
      title,
      evidence: scoringStandard || '未明确',
      suggestion: Array.isArray(item?.response_required_materials)
        ? item.response_required_materials.filter((row) => trimText(row) && trimText(row) !== '未明确').join('；') || '建议补充对应证明材料'
        : '建议补充对应证明材料',
      risk_level: trimText(item?.risk_level || '中').toUpperCase(),
    });
  }
  for (const item of groups) {
    const title = trimText(item?.score_item_name);
    const scoringStandard = trimText(item?.scoring_standard);
    const key = `${title}::${scoringStandard}`;
    if (!title || title === '未明确' || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      section_key: 'SCORING_STANDARD',
      section_title: '评标方法与评标标准',
      title,
      evidence: scoringStandard || '未明确',
      suggestion: Array.isArray(item?.response_required_materials)
        ? item.response_required_materials.filter((row) => trimText(row) && trimText(row) !== '未明确').join('；') || '建议补充对应证明材料'
        : '建议补充对应证明材料',
      risk_level: trimText(item?.risk_level || '中').toUpperCase(),
    });
  }
  return rows;
};

const buildRiskItemsFromFinalJson = ({ finalJson, stage1RiskClauses = [], bidCategory = 'SERVICE' }) => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const rows = [];
  const invalid = finalJson?.invalid_bid_full_clauses || {};
  const invalidPairs = category === 'PRODUCT'
    ? [
      ['qualification_invalid_clauses', '资格性废标条款'],
      ['compliance_invalid_clauses', '符合性废标条款'],
      ['personnel_invalid_clauses', '人员废标条款'],
      ['service_scheme_invalid_clauses', '技术参数废标条款'],
      ['sla_invalid_clauses', '交付/时效废标条款'],
      ['business_invalid_clauses', '商务废标条款'],
      ['quotation_invalid_clauses', '报价废标条款'],
      ['signature_seal_invalid_clauses', '签章密封废标条款'],
      ['other_invalid_clauses', '其他废标条款'],
    ]
    : [
    ['qualification_invalid_clauses', '资格性废标条款'],
    ['compliance_invalid_clauses', '符合性废标条款'],
    ['personnel_invalid_clauses', '人员废标条款'],
    ['service_scheme_invalid_clauses', '服务方案废标条款'],
    ['sla_invalid_clauses', 'SLA废标条款'],
    ['business_invalid_clauses', '商务废标条款'],
    ['quotation_invalid_clauses', '报价废标条款'],
    ['signature_seal_invalid_clauses', '签章密封废标条款'],
    ['other_invalid_clauses', '其他废标条款'],
    ];
  for (const [key, sectionTitle] of invalidPairs) {
    const list = Array.isArray(invalid[key]) ? invalid[key] : [];
    for (const line of list) {
      const text = trimText(line);
      if (!text || text === '未明确') continue;
      rows.push({
        section_key: 'SCORING_STANDARD',
        section_title: sectionTitle,
        title: text.slice(0, 180),
        evidence: text,
        suggestion: '该条款属于高风险条款，需逐条实质性响应并提供可核验证明。',
        risk_level: 'HIGH',
      });
    }
  }
  for (const item of stage1RiskClauses) {
    const text = trimText(item?.clause_content);
    if (!text || text === '未明确') continue;
    rows.push({
      section_key: trimText(item?.source_reference?.chapter) || 'SCORING_STANDARD',
      section_title: trimText(item?.source_reference?.chapter) || '风险条款',
      title: text.slice(0, 180),
      evidence: text,
      suggestion: '命中无效/废标风险，请在投标文件中逐条对应并校验。',
      risk_level: trimText(item?.risk_level) === '中' ? 'MEDIUM' : 'HIGH',
    });
  }
  const dedup = new Set();
  return rows.filter((item) => {
    const key = `${item.title}::${item.section_title}`;
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });
};

const parseScoreNumber = (value) => {
  const text = trimText(value);
  if (!text || text === '未明确') return null;
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatScoreValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '未明确';
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
};

const pushUniqueRowsByKey = (rows, row, keyGetter) => {
  const key = trimText(keyGetter(row));
  if (!key) return rows;
  const exists = rows.some((item) => trimText(keyGetter(item)) === key);
  if (!exists) rows.push(row);
  return rows;
};

const buildBidRiskChecklist = ({ stage1RiskClauses = [], riskItems = [] }) => {
  const rows = [];
  for (const item of stage1RiskClauses) {
    const clause = trimText(item?.clause_content);
    if (!clause) continue;
    pushUniqueRowsByKey(
      rows,
      {
        risk_title: clause,
        risk_level: trimText(item?.risk_level) === '中' ? '中风险' : '高风险',
        clause_type: trimText(item?.clause_type) || 'OTHER_INVALID',
        source_chapter: trimText(item?.source_reference?.chapter) || '未明确',
      },
      (row) => `${row.risk_title}::${row.source_chapter}`
    );
  }
  for (const item of riskItems) {
    const title = trimText(item?.title);
    if (!title) continue;
    pushUniqueRowsByKey(
      rows,
      {
        risk_title: title,
        risk_level: String(trimText(item?.risk_level)).toUpperCase() === 'MEDIUM' ? '中风险' : '高风险',
        clause_type: 'RULE_RISK',
        source_chapter: trimText(item?.section_title || item?.section_key) || '未明确',
      },
      (row) => `${row.risk_title}::${row.source_chapter}`
    );
  }
  return rows.slice(0, 120);
};

const buildScoreStrategy = (finalJson = {}) => {
  const criteria = finalJson?.evaluation_full_criteria || {};
  const priceScore = parseScoreNumber(criteria?.price_score_rules?.full_score);
  const technicalItems = Array.isArray(criteria?.technical_score_items) ? criteria.technical_score_items : [];
  const personnelItems = Array.isArray(criteria?.personnel_score_items) ? criteria.personnel_score_items : [];
  const businessItems = Array.isArray(criteria?.business_score_items) ? criteria.business_score_items : [];
  const policyItems = Array.isArray(criteria?.policy_preference_score_items) ? criteria.policy_preference_score_items : [];

  const sumScores = (list) =>
    list.reduce((acc, item) => {
      const score = parseScoreNumber(item?.full_score);
      return acc + (Number.isFinite(score) ? score : 0);
    }, 0);

  const technicalScore = sumScores(technicalItems) + sumScores(personnelItems);
  const businessScore = sumScores(businessItems) + sumScores(policyItems);
  const matrixRows = Array.isArray(finalJson?.evaluation_score_matrix) ? finalJson.evaluation_score_matrix : [];
  let matrixPrice = 0;
  let matrixTechnical = 0;
  let matrixBusiness = 0;
  for (const row of matrixRows) {
    const score = parseScoreNumber(row?.full_score);
    if (!Number.isFinite(score)) continue;
    const category = trimText(row?.score_category);
    if (category.includes('价格')) {
      matrixPrice += score;
      continue;
    }
    if (category.includes('技术') || category.includes('人员')) {
      matrixTechnical += score;
      continue;
    }
    matrixBusiness += score;
  }
  const computedPrice = Number.isFinite(priceScore) ? priceScore : (matrixPrice > 0 ? matrixPrice : null);
  const computedTechnical = technicalScore > 0 ? technicalScore : matrixTechnical;
  const computedBusiness = businessScore > 0 ? businessScore : matrixBusiness;
  const totalScore = (Number.isFinite(computedPrice) ? computedPrice : 0) + computedTechnical + computedBusiness;
  const totalFromDoc = parseScoreNumber(criteria?.total_full_score);

  return {
    price_score: formatScoreValue(computedPrice),
    technical_score: formatScoreValue(computedTechnical),
    business_score: formatScoreValue(computedBusiness),
    total_theoretical_score: formatScoreValue(totalScore),
    total_full_score_in_tender: formatScoreValue(totalFromDoc),
    note: Number.isFinite(totalFromDoc) && Number.isFinite(totalScore) && Math.abs(totalFromDoc - totalScore) > 0.01
      ? `招标文件总分=${formatScoreValue(totalFromDoc)}，分项合计=${formatScoreValue(totalScore)}，请人工复核评分表。`
      : '已按价格分+技术分+商务分进行理论最高得分计算。',
  };
};

const toChineseChapterNumber = (num) => {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return String(num);
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 10) return n === 10 ? '十' : digits[n];
  if (n < 20) return `十${digits[n - 10]}`;
  if (n % 10 === 0) return `${digits[Math.floor(n / 10)]}十`;
  return `${digits[Math.floor(n / 10)]}十${digits[n % 10]}`;
};

const buildServiceSchemeOutline = ({ scoringItems = [] }) => {
  const outline = [];
  const push = (value) => {
    const text = trimText(value);
    if (!text) return;
    if (!outline.includes(text)) outline.push(text);
  };

  const keywordMap = [
    { title: '项目理解', keywords: ['理解', '需求分析', '项目背景'] },
    { title: '实施方案', keywords: ['实施', '技术方案', '组织方案', '服务方案'] },
    { title: '服务流程', keywords: ['流程', '响应', '运维', '服务流程', 'SLA'] },
    { title: '质量管理', keywords: ['质量', '保障', '考核', '管理'] },
    { title: '应急响应', keywords: ['应急', '故障', '恢复', '预案'] },
    { title: '项目团队配置', keywords: ['团队', '人员', '项目经理', '负责人', '工程师'] },
  ];

  for (const item of scoringItems) {
    const title = trimText(item?.title || item?.score_item_name);
    if (!title) continue;
    for (const mapper of keywordMap) {
      if (mapper.keywords.some((keyword) => title.includes(keyword))) {
        push(mapper.title);
        break;
      }
    }
  }

  for (const fallback of ['项目理解', '实施方案', '服务流程', '质量管理', '应急响应']) {
    push(fallback);
  }
  return outline;
};

const buildAutoBidToc = ({ serviceSchemeOutline = [] }) => {
  const chapterTitles = [
    ...serviceSchemeOutline,
    '商务条款响应',
    '技术偏离表',
    '商务偏离表',
    '附件资料',
  ];
  return chapterTitles.map((title, idx) => `第${toChineseChapterNumber(idx + 1)}章 ${title}`);
};

const buildGoodsSchemeOutline = ({ scoringItems = [], finalJson = {} }) => {
  const outline = [];
  const push = (value) => {
    const text = trimText(value);
    if (!text) return;
    if (!outline.includes(text)) outline.push(text);
  };
  const keywordMap = [
    { title: '项目理解与供货范围', keywords: ['项目理解', '需求分析', '供货范围'] },
    { title: '技术参数响应', keywords: ['技术参数', '参数', '核心产品', '主要产品', '偏离'] },
    { title: '供货实施与交付计划', keywords: ['供货', '交付', '安装', '调试', '实施'] },
    { title: '质量保障与售后服务', keywords: ['质保', '售后', '维护', '服务承诺'] },
    { title: '项目团队与履约保障', keywords: ['项目经理', '团队', '工程师', '履约'] },
  ];
  for (const item of scoringItems) {
    const title = trimText(item?.title || item?.score_item_name);
    if (!title) continue;
    for (const mapper of keywordMap) {
      if (mapper.keywords.some((word) => title.includes(word))) {
        push(mapper.title);
        break;
      }
    }
  }
  const detail = isPlainObject(finalJson?.goods_procurement_detail) ? finalJson.goods_procurement_detail : {};
  const coreParamCount = Array.isArray(detail.core_mandatory_parameters)
    ? detail.core_mandatory_parameters.filter((item) => trimText(item?.param_requirement) && trimText(item?.param_requirement) !== '未明确').length
    : 0;
  if (coreParamCount > 0) push('技术参数响应');
  for (const fallback of ['项目理解与供货范围', '技术参数响应', '供货实施与交付计划', '质量保障与售后服务']) {
    push(fallback);
  }
  return outline;
};

const buildAutoBidTocByCategory = ({ bidCategory = 'SERVICE', serviceSchemeOutline = [] }) => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  if (category === 'PRODUCT') {
    const chapterTitles = [
      ...serviceSchemeOutline,
      '商务条款响应',
      '技术偏离表',
      '商务偏离表',
      '附件资料',
    ];
    return chapterTitles.map((title, idx) => `第${toChineseChapterNumber(idx + 1)}章 ${title}`);
  }
  return buildAutoBidToc({ serviceSchemeOutline });
};

const buildDeviationTables = (finalJson = {}, bidCategory = 'SERVICE') => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const detail = category === 'PRODUCT'
    ? (finalJson?.goods_procurement_detail || {})
    : (finalJson?.service_procurement_detail || {});
  const business = finalJson?.business_performance_rules || {};

  const technicalRows = [];
  const appendTechnical = (requirement, response = '已响应，详见投标文件对应章节', note = '无偏离') => {
    const text = trimText(requirement);
    if (!text || text === '未明确') return;
    technicalRows.push({
      tender_requirement: text,
      bidder_response: response,
      deviation_note: note,
    });
  };

  if (category === 'PRODUCT') {
    const techTable = Array.isArray(finalJson?.technical_deviation_table) ? finalJson.technical_deviation_table : [];
    for (const row of techTable) {
      appendTechnical(
        row?.tender_requirement || row?.param_requirement || row?.param_name,
        row?.bid_response || '已响应，详见技术参数响应表',
        row?.deviation || '无偏离'
      );
    }
    const coreParams = Array.isArray(detail?.core_mandatory_parameters) ? detail.core_mandatory_parameters : [];
    const generalParams = Array.isArray(detail?.general_parameters) ? detail.general_parameters : [];
    for (const item of [...coreParams, ...generalParams]) {
      appendTechnical(item?.param_requirement, '已响应，详见技术参数响应表');
    }
    for (const row of (Array.isArray(detail?.implementation_requirements) ? detail.implementation_requirements : [])) {
      appendTechnical(row, '已响应，详见供货实施与交付计划');
    }
    for (const row of (Array.isArray(detail?.acceptance_requirements) ? detail.acceptance_requirements : [])) {
      appendTechnical(row, '已响应，详见验收与交付章节');
    }
    for (const row of (Array.isArray(detail?.after_sales_requirements) ? detail.after_sales_requirements : [])) {
      appendTechnical(row, '已响应，详见售后服务承诺');
    }
  } else {
    const serviceContentList = Array.isArray(detail?.service_content_list) ? detail.service_content_list : [];
    for (const item of serviceContentList) {
      appendTechnical(item?.service_scope);
      appendTechnical(item?.delivery_content);
    }
    const slaList = Array.isArray(detail?.core_sla_indicators) ? detail.core_sla_indicators : [];
    for (const item of slaList) {
      appendTechnical(item?.indicator_requirement, '已响应，详见服务水平承诺章节');
    }
    for (const row of (Array.isArray(detail?.service_implementation_requirements) ? detail.service_implementation_requirements : [])) {
      appendTechnical(row);
    }
    for (const row of (Array.isArray(detail?.quality_assurance_requirements) ? detail.quality_assurance_requirements : [])) {
      appendTechnical(row);
    }
    for (const row of (Array.isArray(detail?.emergency_response_requirements) ? detail.emergency_response_requirements : [])) {
      appendTechnical(row, '已响应，详见应急响应方案');
    }
    for (const row of (Array.isArray(detail?.training_requirements) ? detail.training_requirements : [])) {
      appendTechnical(row);
    }
  }

  const businessRows = [];
  const appendBusiness = (requirement, response = '已响应，详见商务条款响应', note = '无偏离') => {
    const text = trimText(requirement);
    if (!text || text === '未明确') return;
    businessRows.push({
      tender_requirement: text,
      bidder_response: response,
      deviation_note: note,
    });
  };
  appendBusiness(business?.payment_terms, '已响应，详见付款条款响应');
  appendBusiness(business?.performance_bond_rules, '已响应，详见履约保证金承诺');
  appendBusiness(business?.intellectual_property_rules, '已响应，详见知识产权与保密承诺');
  appendBusiness(business?.liability_for_breach_of_contract, '已响应，详见违约责任响应');
  appendBusiness(business?.renewal_rules, '已响应，详见续约条款响应');
  for (const row of (Array.isArray(business?.other_business_rules) ? business.other_business_rules : [])) {
    appendBusiness(row);
  }
  if (category === 'PRODUCT') {
    const coreProduct = isPlainObject(finalJson?.core_product_info) ? finalJson.core_product_info : {};
    appendBusiness(coreProduct.same_brand_rule, '已响应，详见核心产品与同品牌规则说明');
    appendBusiness(coreProduct.rule_description, '已响应，详见商务条款响应');
  }

  return {
    technical: technicalRows.slice(0, 120),
    business: businessRows.slice(0, 120),
  };
};

const buildGeneratedArtifacts = ({
  finalJson = {},
  stage1RiskClauses = [],
  riskItems = [],
  scoringItems = [],
  bidCategory = 'SERVICE',
}) => {
  const category = normalizeBidCategory(bidCategory) || 'SERVICE';
  const serviceSchemeOutline = category === 'PRODUCT'
    ? buildGoodsSchemeOutline({ scoringItems, finalJson })
    : buildServiceSchemeOutline({ scoringItems });
  const deviationAndResponse = buildDeviationAndResponseTables({
    bidCategory: category,
    finalJson,
  });
  return {
    bid_risk_list: buildBidRiskChecklist({ stage1RiskClauses, riskItems }),
    score_strategy: buildScoreStrategy(finalJson),
    auto_toc: buildAutoBidTocByCategory({ bidCategory: category, serviceSchemeOutline }),
    deviation_tables: deviationAndResponse.deviation_tables,
    response_tables: deviationAndResponse.response_tables,
    service_scheme_outline: serviceSchemeOutline,
  };
};

const buildCompanySummaryLines = (company = {}) => {
  const lines = [];
  const append = (label, value) => {
    const text = trimText(value);
    if (text) lines.push(`${label}：${text}`);
  };
  append('公司名称', company.company_name);
  append('统一社会信用代码', company.uscc);
  append('注册资金', company.registered_capital ? `${company.registered_capital} 万元` : '');
  append('公司性质', company.company_nature);
  append('成立日期', company.established_date);
  append('经营期限', company.business_term);
  append('联系电话', company.contact_phone);
  append('公司邮箱', company.company_email);
  append('公司地址', company.company_address);
  append('登记机关', company.registration_authority);
  append('经营范围', company.business_scope);
  return lines;
};

const buildPersonSummaryLines = (title, person = {}) => {
  const lines = [];
  const append = (label, value) => {
    const text = trimText(value);
    if (text) lines.push(`${label}：${text}`);
  };
  lines.push(title);
  append('姓名', person.name);
  append('身份证号', person.id_no);
  append('性别', person.gender);
  append('出生日期', person.birth_date);
  append('身份证有效期起', person.id_valid_from);
  append('身份证有效期止', person.id_valid_to);
  if (person.id_long_term) lines.push('身份证长期有效：是');
  append('职位', person.position);
  return lines;
};

const buildProjectCoreSummaryLines = (projectCore = {}) => {
  const lines = [];
  const append = (label, value) => {
    const text = trimText(value);
    if (text && text !== '未明确') lines.push(`${label}：${text}`);
  };

  append('项目名称', projectCore.project_full_name || projectCore.project_name);
  append('项目编号', projectCore.project_code);
  append('包号', projectCore.package_no);
  append('预算', projectCore.project_budget);
  append('招标人', projectCore.buyer_full_name);
  append('招标代理机构', projectCore.agency_full_name);
  append('项目所属领域', projectCore.project_domain || projectCore.service_category || projectCore.goods_category);
  append('项目概况', projectCore.project_overview);
  return lines;
};

const toArrayOrEmpty = (value) => (Array.isArray(value) ? value : []);

const joinSummaryLines = (lines = []) => {
  if (!Array.isArray(lines)) return '';
  return lines.map((item) => trimText(item)).filter(Boolean).join('\n').trim();
};

const buildQualificationSummaryLines = (list = []) =>
  toArrayOrEmpty(list).slice(0, 20).map((item, idx) =>
    `${idx + 1}. ${firstNonEmpty(item?.title, item?.name, item?.certName, '资质证书')}｜编号：${firstNonEmpty(item?.certificate_no, item?.certNo, '-')}`
  );

const buildFinanceSummaryLines = (list = []) =>
  toArrayOrEmpty(list).slice(0, 20).map((item, idx) =>
    `${idx + 1}. ${firstNonEmpty(item?.info_name, item?.title, '财务条目')}｜类型：${firstNonEmpty(item?.info_type, '未分类')}｜时间：${firstNonEmpty(item?.info_date, '-')}`
  );

const buildPerformanceSummaryLines = (list = []) =>
  toArrayOrEmpty(list).slice(0, 15).map((item, idx) =>
    `${idx + 1}. ${firstNonEmpty(item?.project_name, item?.title, '业绩条目')}（${firstNonEmpty(item?.party_a_name, '甲方未填')}）`
  );

const buildPersonnelListSummaryLines = (list = []) =>
  toArrayOrEmpty(list).slice(0, 15).map((item, idx) =>
    `${idx + 1}. ${firstNonEmpty(item?.name, '人员')}｜${firstNonEmpty(item?.position, '岗位未填')}｜${firstNonEmpty(item?.major, item?.education, '专业未填')}`
  );

const buildDraftChaptersFromAnalysis = ({
  bidNo,
  title,
  sourceFileName,
  sectionList,
  scoringItems,
  riskItems,
  sampleSections,
  librarySnapshot,
  generatedArtifacts,
  bidCategory = 'SERVICE',
  finalJson = {},
}) => {
  const mapByKey = new Map((sectionList || []).map((item) => [item.section_key, item]));
  const sampleMap = new Map((sampleSections || []).map((item) => [item.section_key, item]));
  const getSectionText = (key) => {
    const selfText = trimText(mapByKey.get(key)?.text);
    const sampleText = trimText(sampleMap.get(key)?.section_text);
    return selfText || sampleText || '';
  };

  const companyLines = buildCompanySummaryLines(librarySnapshot?.company || {});
  const legalLines = buildPersonSummaryLines('法定代表人信息', librarySnapshot?.personnel?.legal || {});
  const agentLines = buildPersonSummaryLines('授权委托人信息', librarySnapshot?.personnel?.agent || {});
  const projectCoreSummaryLines = buildProjectCoreSummaryLines(
    isPlainObject(finalJson?.project_core_info) ? finalJson.project_core_info : {}
  );

  const qualificationList = toArrayOrEmpty(librarySnapshot?.qualifications);
  const financeList = toArrayOrEmpty(librarySnapshot?.finance);
  const performanceList = toArrayOrEmpty(librarySnapshot?.performance);
  const personnelList = toArrayOrEmpty(librarySnapshot?.personnel_list);
  const artifacts = isPlainObject(generatedArtifacts) ? generatedArtifacts : {};
  const autoToc = Array.isArray(artifacts.auto_toc) ? artifacts.auto_toc.filter((item) => trimText(item)) : [];
  const serviceSchemeOutline = Array.isArray(artifacts.service_scheme_outline)
    ? artifacts.service_scheme_outline.filter((item) => trimText(item))
    : [];
  const technicalDeviationRows = Array.isArray(artifacts?.deviation_tables?.technical)
    ? artifacts.deviation_tables.technical
    : [];
  const businessDeviationRows = Array.isArray(artifacts?.deviation_tables?.business)
    ? artifacts.deviation_tables.business
    : [];
  const bidRiskList = Array.isArray(artifacts.bid_risk_list) ? artifacts.bid_risk_list : [];
  const scoreStrategy = isPlainObject(artifacts.score_strategy) ? artifacts.score_strategy : {};
  const normalizedBidCategory = normalizeBidCategory(bidCategory) || 'SERVICE';

  if (normalizedBidCategory === 'PRODUCT') {
    const chapterBlocks = [];
    const goodsDetail = isPlainObject(finalJson?.goods_procurement_detail) ? finalJson.goods_procurement_detail : {};
    const coreProduct = isPlainObject(finalJson?.core_product_info) ? finalJson.core_product_info : {};
    const coreParams = Array.isArray(goodsDetail.core_mandatory_parameters) ? goodsDetail.core_mandatory_parameters : [];
    const generalParams = Array.isArray(goodsDetail.general_parameters) ? goodsDetail.general_parameters : [];
    const matrixRows = Array.isArray(finalJson?.evaluation_score_matrix)
      ? finalJson.evaluation_score_matrix.filter((item) => trimText(item?.score_item_name) && trimText(item?.score_item_name) !== '未明确')
      : [];

    chapterBlocks.push({
      title: '封面',
      content: [
        '投标文件（自动生成初稿）',
        `标书编号：${bidNo}`,
        `标书标题：${title}`,
        '招标类型：产品类',
        `来源招标文件：${sourceFileName}`,
        `生成时间：${formatDateTime(new Date()) || ''}`,
      ],
    });

    chapterBlocks.push({
      title: '目录',
      content: autoToc.length ? autoToc : [
        '第一章 项目理解与供货范围',
        '第二章 技术参数响应',
        '第三章 评分响应与风险校验',
        '第四章 商务条款响应',
        '第五章 技术偏离表',
        '第六章 商务偏离表',
        '第七章 附件资料',
      ],
    });

    chapterBlocks.push({
      title: '投标邀请',
      content: [summarizeSectionText(getSectionText('INVITATION'), 2000) || '未提取到该章节，待人工补充。'],
    });

    chapterBlocks.push({
      title: '投标人须知',
      content: [
        summarizeSectionText(getSectionText('BIDDER_INSTRUCTION'), 1800) || '未提取到该章节，待人工补充。',
        ...(projectCoreSummaryLines.length ? ['', '投标人须知核心信息', ...projectCoreSummaryLines] : []),
        '',
        '投标人基础信息（自有库）',
        ...(companyLines.length ? companyLines : ['公司信息暂未完善']),
        '',
        ...(legalLines.length ? legalLines : ['法定代表人信息暂未完善']),
        '',
        ...(agentLines.length ? agentLines : ['授权委托人信息暂未完善']),
      ],
    });

    chapterBlocks.push({
      title: '采购需求与技术参数',
      content: [
        summarizeSectionText(getSectionText('PROCUREMENT_REQUIREMENT'), 2200) || '未提取到该章节，待人工补充。',
        '',
        `核心产品：${firstNonEmpty(coreProduct.core_product_name, '未明确')}`,
        `同品牌规则：${firstNonEmpty(coreProduct.same_brand_rule, '未明确')}`,
        `规则说明：${firstNonEmpty(coreProduct.rule_description, '未明确')}`,
        '',
        '核心强制参数',
        ...(coreParams.length
          ? coreParams.slice(0, 80).map((item, idx) =>
            `${idx + 1}. ${firstNonEmpty(item.param_name, '参数')}｜要求：${firstNonEmpty(item.param_requirement, '未明确')}｜是否强制：${firstNonEmpty(item.is_mandatory, '否')}｜负偏离废标：${firstNonEmpty(item.negative_deviation_invalid, '否')}`
          )
          : ['未识别到核心强制参数，请人工补充。']),
        '',
        '一般参数',
        ...(generalParams.length
          ? generalParams.slice(0, 120).map((item, idx) =>
            `${idx + 1}. ${firstNonEmpty(item.param_name, '参数')}｜要求：${firstNonEmpty(item.param_requirement, '未明确')}`
          )
          : ['未识别到一般参数，请人工补充。']),
        '',
        '自有库自动匹配材料',
        ...(qualificationList.length
          ? qualificationList.slice(0, 20).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.title, item.name, item.certName, '资质证书')}｜编号：${firstNonEmpty(item.certificate_no, item.certNo, '-')}`)
          : ['暂无资质数据']),
        ...(performanceList.length
          ? performanceList.slice(0, 10).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.project_name, item.title, '业绩条目')}（${firstNonEmpty(item.party_a_name, '甲方未填')}）`)
          : ['暂无业绩数据']),
        ...(personnelList.length
          ? personnelList.slice(0, 10).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.name, '人员')}｜${firstNonEmpty(item.position, '岗位未填')}｜${firstNonEmpty(item.major, item.education, '专业未填')}`)
          : ['暂无人员数据']),
      ],
    });

    chapterBlocks.push({
      title: '评标方法与评分响应',
      content: [
        summarizeSectionText(getSectionText('SCORING_STANDARD'), 1800) || '未提取到该章节，待人工补充。',
        '',
        '理论最高得分',
        `价格分：${firstNonEmpty(scoreStrategy.price_score, '未明确')}`,
        `技术分：${firstNonEmpty(scoreStrategy.technical_score, '未明确')}`,
        `商务分：${firstNonEmpty(scoreStrategy.business_score, '未明确')}`,
        `理论总分：${firstNonEmpty(scoreStrategy.total_theoretical_score, '未明确')}`,
        scoreStrategy.note ? `说明：${scoreStrategy.note}` : '',
        '',
        '评分项清单',
        ...(matrixRows.length
          ? matrixRows.slice(0, 160).map((item, idx) =>
            `${idx + 1}. [${firstNonEmpty(item.score_category, '未明确')}] ${firstNonEmpty(item.score_item_name, '评分项')}\n   分值：${firstNonEmpty(item.full_score, '未明确')}\n   评分标准：${firstNonEmpty(item.scoring_standard, '未明确')}`
          )
          : (scoringItems.length
            ? scoringItems.map((item, idx) => `${idx + 1}. ${item.title}\n   证据：${firstNonEmpty(item.evidence, item.evidence_text, '-')}\n   建议：${firstNonEmpty(item.suggestion, item.suggestion_text, '-')}`)
            : ['暂无评分项，请人工补充'])),
        '',
        '废标风险清单',
        ...(bidRiskList.length
          ? bidRiskList.map((item, idx) =>
            `${idx + 1}. ${firstNonEmpty(item.risk_title, '-')} -> ${firstNonEmpty(item.risk_level, '高风险')}\n   来源：${firstNonEmpty(item.source_chapter, '未明确')}`
          )
          : (riskItems.length
            ? riskItems.map((item, idx) => `${idx + 1}. ${item.title} -> ${String(firstNonEmpty(item.risk_level, 'HIGH')).toUpperCase()}\n   来源：${firstNonEmpty(item.section_title, item.section_key, '-')}`)
            : ['暂无风险项'])),
      ],
    });

    chapterBlocks.push({
      title: '偏离表',
      content: [
        '技术偏离表（招标要求 | 投标响应 | 偏离说明）',
        ...(technicalDeviationRows.length
          ? technicalDeviationRows.map((item, idx) =>
            `${idx + 1}. ${firstNonEmpty(item.tender_requirement, item.param_requirement, '-')}\n   投标响应：${firstNonEmpty(item.bidder_response, item.bid_response, '-')}\n   偏离说明：${firstNonEmpty(item.deviation_note, item.deviation, '无偏离')}\n   证据来源：${firstNonEmpty(item.evidence_source, '待补证据来源')}\n   人工复核：${item.manual_review_required ? '是' : '否'}`
          )
          : ['暂无技术偏离条目，请人工补充。']),
        '',
        '商务偏离表（招标要求 | 投标响应 | 偏离说明）',
        ...(businessDeviationRows.length
          ? businessDeviationRows.map((item, idx) =>
            `${idx + 1}. ${firstNonEmpty(item.tender_requirement, '-')}\n   投标响应：${firstNonEmpty(item.bidder_response, '-')}\n   偏离说明：${firstNonEmpty(item.deviation_note, '无偏离')}\n   证据来源：${firstNonEmpty(item.evidence_source, '待补证据来源')}\n   人工复核：${item.manual_review_required ? '是' : '否'}`
          )
          : ['暂无商务偏离条目，请人工补充。']),
      ],
    });

    chapterBlocks.push({
      title: '合同主要条款及格式',
      content: [
        summarizeSectionText(getSectionText('CONTRACT_TERMS'), 1800) || '未提取到该章节，待人工补充。',
        '',
        '财务与履约信息（自有库）',
        ...(financeList.length
          ? financeList.slice(0, 20).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.info_name, item.title, '财务条目')}｜类型：${firstNonEmpty(item.info_type, '未分类')}｜时间：${firstNonEmpty(item.info_date, '-')}`)
          : ['暂无财务信息']),
      ],
    });

    chapterBlocks.push({
      title: '投标文件格式',
      content: [
        summarizeSectionText(getSectionText('BID_DOC_FORMAT'), 1600) || '未提取到该章节，待人工补充。',
        '',
        '附录索引',
        'A. 公司信息',
        'B. 资质证书',
        'C. 财务信息',
        'D. 业绩信息',
        'E. 人员信息',
      ],
    });

    return chapterBlocks;
  }

  const chapterBlocks = [];

  chapterBlocks.push({
    title: '封面',
    content: [
      `投标文件（自动生成初稿）`,
      `标书编号：${bidNo}`,
      `标书标题：${title}`,
      `来源招标文件：${sourceFileName}`,
      `生成时间：${formatDateTime(new Date()) || ''}`,
    ],
  });

  chapterBlocks.push({
    title: '目录',
    content: autoToc.length ? autoToc : tenderSectionDefs.map((item, idx) => `${idx + 1}. ${item.title}`),
  });

  chapterBlocks.push({
    title: '投标邀请',
    content: [summarizeSectionText(getSectionText('INVITATION'), 2000) || '未提取到该章节，待人工补充。'],
  });

  chapterBlocks.push({
    title: '投标人须知',
    content: [
      summarizeSectionText(getSectionText('BIDDER_INSTRUCTION'), 1800) || '未提取到该章节，待人工补充。',
      ...(projectCoreSummaryLines.length ? ['', '投标人须知核心信息', ...projectCoreSummaryLines] : []),
      '',
      '投标人基础信息（自有库）',
      ...(companyLines.length ? companyLines : ['公司信息暂未完善']),
      '',
      ...(legalLines.length ? legalLines : ['法定代表人信息暂未完善']),
      '',
      ...(agentLines.length ? agentLines : ['授权委托人信息暂未完善']),
    ],
  });

  chapterBlocks.push({
    title: '采购需求',
    content: [
      summarizeSectionText(getSectionText('PROCUREMENT_REQUIREMENT'), 2000) || '未提取到该章节，待人工补充。',
      '',
      '业绩能力（自有库）',
      ...(performanceList.length
        ? performanceList.slice(0, 15).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.project_name, item.title, '业绩条目')}（${firstNonEmpty(item.party_a_name, '甲方未填')}）`)
        : ['暂无业绩数据']),
      '',
      '人员能力（自有库）',
      ...(personnelList.length
        ? personnelList.slice(0, 15).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.name, '人员')}｜${firstNonEmpty(item.position, '岗位未填')}｜${firstNonEmpty(item.education, '学历未填')}`)
        : ['暂无人员数据']),
      '',
      '资质能力（自有库）',
      ...(qualificationList.length
        ? qualificationList.slice(0, 20).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.title, item.name, item.certName, '资质证书')}｜编号：${firstNonEmpty(item.certificate_no, item.certNo, '-')}`)
        : ['暂无资质数据']),
    ],
  });

  chapterBlocks.push({
    title: '评标方法与评标标准',
    content: [
      summarizeSectionText(getSectionText('SCORING_STANDARD'), 1800) || '未提取到该章节，待人工补充。',
      '',
      '理论最高得分',
      `价格分：${firstNonEmpty(scoreStrategy.price_score, '未明确')}`,
      `技术分：${firstNonEmpty(scoreStrategy.technical_score, '未明确')}`,
      `商务分：${firstNonEmpty(scoreStrategy.business_score, '未明确')}`,
      `理论总分：${firstNonEmpty(scoreStrategy.total_theoretical_score, '未明确')}`,
      scoreStrategy.note ? `说明：${scoreStrategy.note}` : '',
      '',
      '得分项清单',
      ...(scoringItems.length
        ? scoringItems.map((item, idx) => `${idx + 1}. ${item.title}\n   证据：${firstNonEmpty(item.evidence, item.evidence_text, '-')}\n   建议：${firstNonEmpty(item.suggestion, item.suggestion_text, '-')}`)
        : ['暂无得分项，请人工补充']),
      '',
      '废标风险清单',
      ...(bidRiskList.length
        ? bidRiskList.map((item, idx) =>
          `${idx + 1}. ${firstNonEmpty(item.risk_title, '-')} -> ${firstNonEmpty(item.risk_level, '高风险')}\n   来源：${firstNonEmpty(item.source_chapter, '未明确')}`
        )
        : (riskItems.length
          ? riskItems.map((item, idx) => `${idx + 1}. ${item.title} -> ${String(firstNonEmpty(item.risk_level, 'HIGH')).toUpperCase()}\n   来源：${firstNonEmpty(item.section_title, item.section_key, '-')}`)
          : ['暂无风险项'])),
    ],
  });

  chapterBlocks.push({
    title: '服务方案框架',
    content: [
      '根据评分项自动生成的服务方案建议结构：',
      ...(serviceSchemeOutline.length ? serviceSchemeOutline.map((item, idx) => `${idx + 1}. ${item}`) : ['项目理解', '实施方案', '服务流程', '质量管理', '应急响应']),
    ],
  });

  chapterBlocks.push({
    title: '偏离表',
    content: [
      '技术偏离表（招标要求 | 投标响应 | 偏离说明）',
      ...(technicalDeviationRows.length
        ? technicalDeviationRows.map((item, idx) =>
          `${idx + 1}. ${firstNonEmpty(item.tender_requirement, '-')}\n   投标响应：${firstNonEmpty(item.bidder_response, '-')}\n   偏离说明：${firstNonEmpty(item.deviation_note, '无偏离')}\n   证据来源：${firstNonEmpty(item.evidence_source, '待补证据来源')}\n   人工复核：${item.manual_review_required ? '是' : '否'}`
        )
        : ['暂无技术偏离条目，请人工补充。']),
      '',
      '商务偏离表（招标要求 | 投标响应 | 偏离说明）',
      ...(businessDeviationRows.length
        ? businessDeviationRows.map((item, idx) =>
          `${idx + 1}. ${firstNonEmpty(item.tender_requirement, '-')}\n   投标响应：${firstNonEmpty(item.bidder_response, '-')}\n   偏离说明：${firstNonEmpty(item.deviation_note, '无偏离')}\n   证据来源：${firstNonEmpty(item.evidence_source, '待补证据来源')}\n   人工复核：${item.manual_review_required ? '是' : '否'}`
        )
        : ['暂无商务偏离条目，请人工补充。']),
    ],
  });

  chapterBlocks.push({
    title: '合同主要条款及格式',
    content: [
      summarizeSectionText(getSectionText('CONTRACT_TERMS'), 1800) || '未提取到该章节，待人工补充。',
      '',
      '财务与履约信息（自有库）',
      ...(financeList.length
        ? financeList.slice(0, 20).map((item, idx) => `${idx + 1}. ${firstNonEmpty(item.info_name, item.title, '财务条目')}｜类型：${firstNonEmpty(item.info_type, '未分类')}｜时间：${firstNonEmpty(item.info_date, '-')}`)
        : ['暂无财务信息']),
    ],
  });

  chapterBlocks.push({
    title: '投标文件格式',
    content: [
      summarizeSectionText(getSectionText('BID_DOC_FORMAT'), 1600) || '未提取到该章节，待人工补充。',
      '',
      '附录索引',
      'A. 公司信息',
      'B. 资质证书',
      'C. 财务信息',
      'D. 业绩信息',
      'E. 人员信息',
    ],
  });

  return chapterBlocks;
};

const buildParagraphsFromChapters = (chapters = []) => {
  const rows = [];
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    const chapterTitle = trimText(chapter?.title);
    if (chapterTitle) rows.push(chapterTitle);
    const lines = Array.isArray(chapter?.content) ? chapter.content : toLines(chapter?.content || '');
    for (const line of lines) {
      rows.push(trimText(line));
    }
    rows.push('');
  }
  return rows;
};

const persistRequirementRegistry = async (tx, jobId, rows = []) => {
  await tx.run('DELETE FROM tender_requirement_registry WHERE job_id = ?', [Number(jobId)]);
  for (const row of Array.isArray(rows) ? rows : []) {
    await tx.run(
      `INSERT INTO tender_requirement_registry
        (job_id, requirement_code, bid_category, requirement_type, title, requirement_text, section_key, section_title, suggestion_text, risk_level, source_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(jobId),
        trimText(row.requirement_code),
        trimText(row.bid_category) || null,
        trimText(row.requirement_type),
        trimText(row.title) || null,
        trimText(row.requirement_text) || null,
        trimText(row.section_key) || null,
        trimText(row.section_title) || null,
        trimText(row.suggestion_text) || null,
        trimText(row.risk_level) || null,
        trimText(row.source_json) || null,
      ]
    );
  }
};

const persistEvidenceRegistry = async (tx, bidId, rows = []) => {
  await tx.run('DELETE FROM tender_evidence_registry WHERE bid_id = ?', [Number(bidId)]);
  for (const row of Array.isArray(rows) ? rows : []) {
    await tx.run(
      `INSERT INTO tender_evidence_registry
        (bid_id, evidence_code, evidence_type, title, evidence_text, library_record_id, source_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(bidId),
        trimText(row.evidence_code),
        trimText(row.evidence_type),
        trimText(row.title) || null,
        trimText(row.evidence_text) || null,
        Number(row.library_record_id || 0) || null,
        trimText(row.source_json) || null,
      ]
    );
  }
};

const persistDraftSectionRegistry = async (tx, bidId, versionId, rows = []) => {
  await tx.run(
    'DELETE FROM tender_draft_section_registry WHERE bid_id = ? AND version_id = ?',
    [Number(bidId), Number(versionId)]
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    await tx.run(
      `INSERT INTO tender_draft_section_registry
        (bid_id, version_id, section_title, paragraph_no, paragraph_text, template_slot, requirement_ids_json, evidence_ids_json, score_item_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(bidId),
        Number(versionId),
        trimText(row.section_title) || null,
        Number(row.paragraph_no || 0),
        trimText(row.paragraph_text) || null,
        trimText(row.template_slot) || null,
        trimText(row.requirement_ids_json) || '[]',
        trimText(row.evidence_ids_json) || '[]',
        trimText(row.score_item_ids_json) || '[]',
      ]
    );
  }
};

const persistDraftArtifactRows = async (tx, { bidId, versionId, rows = [], user }) => {
  await tx.run(
    'DELETE FROM tender_draft_artifact_rows WHERE bid_id = ? AND version_id = ?',
    [Number(bidId), Number(versionId)]
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    await tx.run(
      `INSERT INTO tender_draft_artifact_rows
        (bid_id, version_id, artifact_type, artifact_group, row_no, row_json, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(bidId),
        Number(versionId),
        trimText(row.artifact_type).toUpperCase() || 'DEVIATION_TABLE',
        trimText(row.artifact_group).toUpperCase() || 'TECHNICAL',
        Number(row.row_no || 0),
        trimText(row.row_json) || '{}',
        Number(user?.id || 0) || null,
        trimText(user?.username) || null,
        Number(user?.id || 0) || null,
        trimText(user?.username) || null,
      ]
    );
  }
};

const persistScoreCoverageMatrix = async (tx, { bidId, versionId, rows = [] }) => {
  await tx.run(
    'DELETE FROM tender_score_coverage_matrix WHERE bid_id = ? AND version_id = ?',
    [Number(bidId), Number(versionId || 0) || null]
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    await tx.run(
      `INSERT INTO tender_score_coverage_matrix
        (bid_id, version_id, score_item_id, requirement_id, requirement_code, title, full_score, coverage_status, optimization_needed_flag, optimization_reason, target_section_title, bound_evidence_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(bidId),
        Number(versionId || 0) || null,
        trimText(row.score_item_id),
        Number(row.requirement_id || 0) || null,
        trimText(row.requirement_code) || null,
        trimText(row.title) || null,
        Number(row.full_score || 0),
        trimText(row.coverage_status) || 'NONE',
        Number(row.optimization_needed_flag || 0),
        trimText(row.optimization_reason) || null,
        trimText(row.target_section_title) || null,
        trimText(row.bound_evidence_ids_json) || '[]',
      ]
    );
  }
};

const persistScoreOptimizationRecords = async (tx, { bidId, versionId, rows = [], user }) => {
  await tx.run(
    'DELETE FROM tender_score_optimization_records WHERE bid_id = ? AND version_id = ?',
    [Number(bidId), Number(versionId || 0) || null]
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    await tx.run(
      `INSERT INTO tender_score_optimization_records
        (bid_id, version_id, score_item_id, suggestion_title, suggestion_text, evidence_ids_json, target_section_title, before_text, after_text, applied_flag, applied_at, source, strategy_profile_key, audit_trace_json, status, created_by_id, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(bidId),
        Number(versionId || 0) || null,
        trimText(row.score_item_id),
        trimText(row.suggestion_title) || null,
        trimText(row.suggestion_text) || null,
        JSON.stringify(Array.isArray(row.evidence_ids) ? row.evidence_ids : []),
        trimText(row.section_title || row.target_section_title) || null,
        trimText(row.before_text) || null,
        trimText(row.after_text) || null,
        Number(row.applied_flag || (trimText(row.status).toUpperCase() === 'APPLIED' ? 1 : 0)),
        Number(row.applied_flag || (trimText(row.status).toUpperCase() === 'APPLIED' ? 1 : 0)) ? (formatDateTime(new Date()) || null) : null,
        trimText(row.source) || 'RULE',
        trimText(row.strategy_profile_key) || null,
        JSON.stringify({
          strategy_hit_points: Array.isArray(row.strategy_hit_points) ? row.strategy_hit_points : [],
          strategy_section_patterns: Array.isArray(row.strategy_section_patterns) ? row.strategy_section_patterns : [],
          strategy_source_project_ids: Array.isArray(row.strategy_source_project_ids) ? row.strategy_source_project_ids : [],
          strategy_source_score_item_ids: Array.isArray(row.strategy_source_score_item_ids) ? row.strategy_source_score_item_ids : [],
        }),
        trimText(row.status).toUpperCase() === 'APPLIED' ? 'APPLIED' : 'PROPOSED',
        Number(user?.id || 0) || null,
        trimText(user?.username) || null,
      ]
    );
  }
};

const loadRequirementRegistryRows = async (jobId) =>
  query(
    `SELECT *
     FROM tender_requirement_registry
     WHERE job_id = ?
     ORDER BY id ASC`,
    [Number(jobId)]
  );

const loadEvidenceRegistryRows = async (bidId) =>
  query(
    `SELECT *
     FROM tender_evidence_registry
     WHERE bid_id = ?
     ORDER BY id ASC`,
    [Number(bidId)]
  );

const loadDraftSectionRegistryRows = async ({ bidId, versionId }) =>
  query(
    `SELECT *
     FROM tender_draft_section_registry
     WHERE bid_id = ? AND version_id = ?
     ORDER BY paragraph_no ASC, id ASC`,
    [Number(bidId), Number(versionId)]
  );

const loadDraftArtifactRows = async ({ bidId, versionId }) =>
  query(
    `SELECT *
     FROM tender_draft_artifact_rows
     WHERE bid_id = ? AND version_id = ?
     ORDER BY artifact_type ASC, artifact_group ASC, row_no ASC, id ASC`,
    [Number(bidId), Number(versionId)]
  );

const loadValidationRuleRows = async ({ ruleType = '', issueType = '', activeOnly = false, limit = 200 } = {}) => {
  const conditions = [];
  const params = [];
  if (activeOnly) {
    conditions.push('active_flag = 1');
  }
  const normalizedRuleType = trimText(ruleType).toUpperCase();
  if (normalizedRuleType) {
    conditions.push('rule_type = ?');
    params.push(normalizedRuleType);
  }
  const cappedLimit = Math.max(1, Math.min(500, Number(limit || 0) || 200));
  const rows = await query(
    `SELECT *
     FROM kb_validation_rules
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY rule_type ASC, severity DESC, id ASC
     LIMIT ?`,
    [...params, cappedLimit]
  );
  const normalizedRows = rows.map((item) => sanitizeValidationRuleRow(item));
  const normalizedIssueType = trimText(issueType);
  if (!normalizedIssueType) return normalizedRows;
  return normalizedRows.filter((item) => trimText(item?.tags?.issue_type) === normalizedIssueType);
};

const syncValidationRuleLibrary = async () => {
  const existingRows = await query('SELECT rule_name FROM kb_validation_rules');
  const missingRules = buildMissingValidationRules({
    existingRules: existingRows,
    seedRules: buildValidationRuleSeed(),
  });
  for (const row of missingRules) {
    await run(
      `INSERT INTO kb_validation_rules
        (rule_name, rule_type, trigger_condition, check_logic, severity, suggested_action, active_flag, tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.rule_name,
        row.rule_type,
        row.trigger_condition || null,
        row.check_logic,
        row.severity,
        row.suggested_action || null,
        Number(row.active_flag || 0) === 1 ? 1 : 0,
        JSON.stringify(row.tags || {}),
      ]
    );
  }
  const totalRow = await get('SELECT COUNT(1) AS count FROM kb_validation_rules');
  return {
    inserted_count: missingRules.length,
    total_count: Number(totalRow?.count || 0),
  };
};

const loadLatestDraftCheckRun = async ({ bidId }) => {
  const runRow = await get(
    `SELECT *
     FROM tender_draft_check_runs
     WHERE bid_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(bidId)]
  );
  if (!runRow) return { run: null, issues: [] };
  const issueRows = await query(
    `SELECT *
     FROM tender_draft_check_issues
     WHERE check_run_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [Number(runRow.id)]
  );
  return {
    run: sanitizeDraftCheckRunRow(runRow),
    issues: issueRows.map((item) => sanitizeDraftCheckIssueRow(item)),
  };
};

const loadScoreCoverageRows = async ({ bidId, versionId }) =>
  query(
    `SELECT *
     FROM tender_score_coverage_matrix
     WHERE bid_id = ? AND version_id = ?
     ORDER BY id ASC`,
    [Number(bidId), Number(versionId || 0) || null]
  );

const loadScoreOptimizationRecordRows = async ({ bidId, versionId }) =>
  query(
    `SELECT *
     FROM tender_score_optimization_records
     WHERE bid_id = ? AND version_id = ?
     ORDER BY id DESC`,
    [Number(bidId), Number(versionId || 0) || null]
  );

const loadDraftAutosaveRows = async ({ bidId, limit = 20 }) =>
  query(
    `SELECT *
     FROM tender_bid_draft_autosaves
     WHERE bid_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [Number(bidId), Math.min(100, Math.max(1, Number(limit || 20)))]
  );

const loadExportRecordsByBidIds = async ({ bidIds = [], limit = 200 }) => {
  const ids = Array.from(
    new Set(
      (Array.isArray(bidIds) ? bidIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
  if (!ids.length) return [];
  const take = Math.min(1000, Math.max(ids.length, Number(limit || 200)));
  const rows = await query(
    `SELECT *
     FROM tender_bid_export_records
     WHERE bid_id IN (${ids.map(() => '?').join(',')})
     ORDER BY id DESC
     LIMIT ?`,
    [...ids, take]
  );
  return rows.map((item) => sanitizeExportRecordRow(item));
};

const buildLatestBidRowMap = (rows = [], bidIdSelector) => {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const bidId = Number(bidIdSelector(row));
    if (!Number.isFinite(bidId) || bidId <= 0 || map.has(bidId)) continue;
    map.set(bidId, row);
  }
  return map;
};

const loadLatestGenerateJobForBid = async (bidId) => {
  const row = await get(
    `SELECT *
     FROM tender_bid_generate_jobs
     WHERE created_bid_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(bidId)]
  );
  return row ? sanitizeGenerateJobRow(row) : null;
};

const buildRiskCenterProjectRows = async (bids = []) => {
  const bidRows = Array.isArray(bids) ? bids.map((item) => sanitizeBidRow(item)).filter(Boolean) : [];
  const bidIds = bidRows.map((item) => Number(item.id)).filter((item) => Number.isFinite(item) && item > 0);
  if (!bidIds.length) return [];

  const [parseJobs, checkRuns, exportRecords] = await Promise.all([
    query(
      `SELECT *
       FROM tender_bid_parse_jobs
       WHERE bid_id IN (${bidIds.map(() => '?').join(',')})
       ORDER BY id DESC`,
      bidIds
    ),
    query(
      `SELECT *
       FROM tender_draft_check_runs
       WHERE bid_id IN (${bidIds.map(() => '?').join(',')})
       ORDER BY id DESC`,
      bidIds
    ),
    loadExportRecordsByBidIds({ bidIds, limit: Math.max(300, bidIds.length * 3) }),
  ]);

  const parseJobMap = buildLatestBidRowMap(parseJobs.map((item) => sanitizeParseJobRow(item)), (item) => item?.bid_id);
  const checkRunMap = buildLatestBidRowMap(checkRuns.map((item) => sanitizeDraftCheckRunRow(item)), (item) => item?.bid_id);
  const exportRecordMap = buildLatestBidRowMap(exportRecords, (item) => item?.bid_id);

  const levelWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return bidRows
    .map((bid) => buildRiskProjectRow({
      bid,
      latestParseJob: parseJobMap.get(Number(bid.id)) || null,
      latestDraftCheckRun: checkRunMap.get(Number(bid.id)) || null,
      latestExportRecord: exportRecordMap.get(Number(bid.id)) || null,
    }))
    .sort((a, b) => {
      const levelDiff = (levelWeight[String(b.risk_level || '').toUpperCase()] || 0) - (levelWeight[String(a.risk_level || '').toUpperCase()] || 0);
      if (levelDiff !== 0) return levelDiff;
      return new Date(String(b.updated_at || b.latest_check_at || b.latest_export_at || 0)).getTime()
        - new Date(String(a.updated_at || a.latest_check_at || a.latest_export_at || 0)).getTime();
    });
};

const buildExportCenterProjectRows = async (bids = []) => {
  const bidRows = Array.isArray(bids) ? bids.map((item) => sanitizeBidRow(item)).filter(Boolean) : [];
  const bidIds = bidRows.map((item) => Number(item.id)).filter((item) => Number.isFinite(item) && item > 0);
  if (!bidIds.length) return { projectRows: [], exportRecords: [] };
  const currentVersionIds = Array.from(
    new Set(
      bidRows
        .map((item) => Number(item.current_version_id))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );

  const [draftRows, versionRows, exportRecords] = await Promise.all([
    query(
      `SELECT *
       FROM tender_bid_drafts
       WHERE bid_id IN (${bidIds.map(() => '?').join(',')})`,
      bidIds
    ),
    currentVersionIds.length
      ? query(
        `SELECT *
         FROM tender_bid_versions
         WHERE id IN (${currentVersionIds.map(() => '?').join(',')})`,
        currentVersionIds
      )
      : Promise.resolve([]),
    loadExportRecordsByBidIds({ bidIds, limit: Math.max(500, bidIds.length * 4) }),
  ]);

  const draftMap = new Map(draftRows.map((item) => [Number(item.bid_id), sanitizeDraftRow(item)]));
  const versionMap = new Map(versionRows.map((item) => [Number(item.id), sanitizeVersionRow(item)]));
  const exportRecordMap = buildLatestBidRowMap(exportRecords, (item) => item?.bid_id);
  const projectRows = bidRows.map((bid) => {
    const latestExport = exportRecordMap.get(Number(bid.id)) || null;
    const draft = draftMap.get(Number(bid.id)) || null;
    const currentVersion = versionMap.get(Number(bid.current_version_id)) || null;
    return {
      bid_id: Number(bid.id),
      bid_no: fixMojibakeText(bid.bid_no),
      title: fixMojibakeText(bid.title),
      project_name: fixMojibakeText(bid.project_name),
      status: trimText(bid.status).toUpperCase() || 'DRAFT',
      current_version_id: Number(bid.current_version_id || 0) || null,
      current_version_no: Number(currentVersion?.version_no || 0) || null,
      current_version_file_name: fixMojibakeText(currentVersion?.file_name),
      draft_updated_at: draft?.updated_at || draft?.last_saved_at || null,
      draft_file_name: fixMojibakeText(draft?.draft_file_name),
      latest_export_record: latestExport,
      export_ready_flag: ['EXPORT_READY', 'EXPORTED', 'ARCHIVED', 'SUBMITTED'].includes(trimText(bid.status).toUpperCase()),
      updated_at: bid.updated_at || bid.created_at || null,
    };
  }).sort((a, b) => new Date(String(b.updated_at || b.draft_updated_at || 0)).getTime() - new Date(String(a.updated_at || a.draft_updated_at || 0)).getTime());

  return { projectRows, exportRecords };
};

const resolveDraftWorkspaceVersionId = ({ bid, currentVersion, draft }) => {
  const versionId = Number(currentVersion?.id || bid?.current_version_id || draft?.base_version_id || 0);
  return Number.isFinite(versionId) && versionId > 0 ? versionId : 0;
};

const buildDraftWorkspacePayload = async ({ bid, currentVersion, draft }) => {
  const bidId = Number(bid.id);
  const versionId = resolveDraftWorkspaceVersionId({ bid, currentVersion, draft });
  const latestJob = await loadLatestGenerateJobForBid(bidId);
  const latestDetail = latestJob ? await loadGenerateJobDetail(latestJob.id) : null;
  let requirementRegistry = latestJob ? await loadRequirementRegistryRows(latestJob.id) : [];
  if (!requirementRegistry.length && latestDetail) {
    requirementRegistry = buildRuntimeRequirementRegistry({ detail: latestDetail });
  }
  const evidenceRegistry = await loadEvidenceRegistryRows(bidId);
  const clauseRegistryV2 = buildClauseRegistryV2({
    requirements: requirementRegistry,
  });

  let sections = versionId ? await loadDraftSectionRegistryRows({ bidId, versionId }) : [];
  if ((!Array.isArray(sections) || !sections.length) && (currentVersion || draft)) {
    const draftFilePath = trimText(draft?.draft_file_path) || trimText(currentVersion?.storage_path);
    const paragraphs = await extractParagraphsFromDocx(draftFilePath);
    if (paragraphs.length) {
      sections = paragraphs.map((paragraph, index) => ({
        id: 0,
        section_title: '文档正文',
        paragraph_no: index + 1,
        paragraph_text: paragraph,
        requirement_ids_json: '[]',
        evidence_ids_json: '[]',
        score_item_ids_json: '[]',
      }));
    }
  }
  const normalizedSections = normalizeDraftSectionRows(sections);
  const persistedArtifactRows = versionId
    ? await loadDraftArtifactRows({ bidId, versionId })
    : [];
  const analysisSummary = parseMaybeJson(latestDetail?.job?.analysis_summary_json, {});
  const generatedArtifacts = isPlainObject(analysisSummary?.generated_artifacts)
    ? analysisSummary.generated_artifacts
    : {};
  const artifacts = buildDraftArtifactCollections({
    persistedRows: persistedArtifactRows.map((item) => sanitizeDraftArtifactRow(item)),
    generatedArtifacts,
  });

  const { run: latestCheckRun, issues: latestCheckIssues } = await loadLatestDraftCheckRun({ bidId });
  let scoreCoverageRows = versionId ? await loadScoreCoverageRows({ bidId, versionId }) : [];
  if (!scoreCoverageRows.length && requirementRegistry.length) {
    scoreCoverageRows = buildScoreCoverageMatrix({
      requirements: requirementRegistry,
      sections: normalizedSections.map((item) => ({
        section_title: item.section_title,
        paragraph_text: item.paragraph_text,
        requirement_ids_json: JSON.stringify(item.requirement_ids || []),
        evidence_ids_json: JSON.stringify(item.evidence_ids || []),
        score_item_ids_json: JSON.stringify(item.score_item_ids || []),
      })),
      evidences: evidenceRegistry,
    });
  }
  const optimizationRows = versionId ? await loadScoreOptimizationRecordRows({ bidId, versionId }) : [];
  const autosaves = await loadDraftAutosaveRows({ bidId, limit: 20 });

  return {
    bid: sanitizeBidRow(bid),
    version: currentVersion ? sanitizeVersionRow(currentVersion) : null,
    draft: draft ? sanitizeDraftRow(draft) : null,
    source_job_id: Number(latestJob?.id || 0) || null,
    sections: normalizedSections,
    artifacts,
    latest_check_run: latestCheckRun,
    latest_check_issues: latestCheckIssues,
    score_coverage_matrix: scoreCoverageRows.map((item) => sanitizeScoreCoverageRow(item)),
    score_optimization_records: optimizationRows.map((item) => sanitizeScoreOptimizationRecordRow(item)),
    autosaves: autosaves.map((item) => sanitizeDraftAutosaveRow(item)),
    requirement_registry: requirementRegistry,
    evidence_registry: evidenceRegistry,
    clause_registry_v2: clauseRegistryV2,
  };
};

const extractParagraphsFromDocx = async (filePath) => {
  const target = trimText(filePath);
  if (!target) return [];
  const stat = await readFileStatSafe(target);
  if (!stat?.isFile()) return [];
  const ext = path.extname(target).toLowerCase();
  if (!['.docx', '.doc'].includes(ext)) return [];
  try {
    const extracted = await mammoth.extractRawText({ path: target });
    return toLines(extracted?.value || '');
  } catch {
    return [];
  }
};

const buildRuntimeRequirementRegistry = ({ detail }) => {
  if (!detail?.job) return [];
  const analysisSummary = parseMaybeJson(detail.job.analysis_summary_json, {});
  const stageOutputs = isPlainObject(analysisSummary?.stage_outputs) ? analysisSummary.stage_outputs : {};
  const bidCategory = normalizeBidCategory(detail.job.bid_category) || 'SERVICE';
  return buildRequirementRows({
    jobId: Number(detail.job.id),
    bidCategory,
    finalJson: normalizeFinalAnalyzeJson(analysisSummary?.final_json || {}, bidCategory),
    scoringItems: Array.isArray(detail.items) ? detail.items.filter((item) => item.item_type === 'SCORING') : [],
    stage1RiskClauses: normalizeStage1RiskClauses(stageOutputs.stage1_risk_clauses || []),
    tableSummaries: Array.isArray(analysisSummary?.table_summaries) ? analysisSummary.table_summaries : [],
  });
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

const statusTransitions = {
  DRAFT: new Set(['FILES_UPLOADED', 'IN_REVIEW']),
  FILES_UPLOADED: new Set(['PARSE_COMPLETED', 'MATERIALS_PENDING', 'DRAFT']),
  PARSE_COMPLETED: new Set(['MATERIALS_PENDING', 'READY_TO_GENERATE', 'DRAFT']),
  MATERIALS_PENDING: new Set(['READY_TO_GENERATE', 'PARSE_COMPLETED', 'DRAFT']),
  READY_TO_GENERATE: new Set(['GENERATING', 'COMPILE_REVIEW_PENDING', 'DRAFT']),
  GENERATING: new Set(['COMPILE_REVIEW_PENDING', 'MATERIALS_PENDING', 'DRAFT']),
  COMPILE_REVIEW_PENDING: new Set(['TECH_REVIEW_PENDING', 'READY_TO_GENERATE', 'DRAFT']),
  TECH_REVIEW_PENDING: new Set(['BUSINESS_REVIEW_PENDING', 'COMPILE_REVIEW_PENDING', 'DRAFT']),
  BUSINESS_REVIEW_PENDING: new Set(['FINAL_REVIEW_PENDING', 'TECH_REVIEW_PENDING', 'DRAFT']),
  FINAL_REVIEW_PENDING: new Set(['EXPORT_READY', 'BUSINESS_REVIEW_PENDING', 'DRAFT']),
  EXPORT_READY: new Set(['EXPORTED', 'FINAL_REVIEW_PENDING', 'DRAFT']),
  EXPORTED: new Set(['ARCHIVED', 'DRAFT']),
  // 兼容旧状态流转
  IN_REVIEW: new Set(['FINALIZED', 'DRAFT']),
  FINALIZED: new Set(['SUBMITTED', 'DRAFT']),
  SUBMITTED: new Set(['ARCHIVED', 'DRAFT']),
  ARCHIVED: new Set(['DRAFT']),
};

const reviewStageToPendingStatus = {
  COMPILE: 'COMPILE_REVIEW_PENDING',
  TECH: 'TECH_REVIEW_PENDING',
  BUSINESS: 'BUSINESS_REVIEW_PENDING',
  FINAL: 'FINAL_REVIEW_PENDING',
};

const reviewStageToNextStatusOnApproved = {
  COMPILE: 'TECH_REVIEW_PENDING',
  TECH: 'BUSINESS_REVIEW_PENDING',
  BUSINESS: 'FINAL_REVIEW_PENDING',
  FINAL: 'EXPORT_READY',
};

const normalizeBidUploadExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_BID_UPLOAD_EXTS.has(ext) ? ext : '';
};

const normalizeParseUploadExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_PARSE_UPLOAD_EXTS.has(ext) ? ext : '';
};

const normalizeAssetUploadExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_ASSET_UPLOAD_EXTS.has(ext) ? ext : '';
};

const normalizeDocTemplateExt = (filename) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ALLOWED_DOC_TEMPLATE_EXTS.has(ext) ? ext : '';
};

const guessMimeByExt = (ext) => {
  const normalized = trimText(ext).toLowerCase();
  if (normalized === '.pdf') return 'application/pdf';
  if (normalized === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalized === '.doc') return 'application/msword';
  if (normalized === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (normalized === '.xls') return 'application/vnd.ms-excel';
  if (normalized === '.zip') return 'application/zip';
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
    child.on('error', (err) => reject(tenderStageError({
      message: `LibreOffice 转换启动失败: ${trimText(err?.message) || '未知错误'}`,
      statusCode: 502,
      code: 'TENDER_FILE_CONVERT_UNAVAILABLE',
      category: 'CONVERT',
      retryable: true,
      manualTakeover: buildManualTakeover('请稍后重试，或检查 LibreOffice 环境后再导出', 'convert'),
    })));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      return reject(tenderStageError({
        message: stderr || `LibreOffice 转换失败，退出码 ${code}`,
        statusCode: 502,
        code: 'TENDER_FILE_CONVERT_FAILED',
        category: 'CONVERT',
        retryable: true,
        manualTakeover: buildManualTakeover('请稍后重试，或检查源文件后重新导出', 'convert'),
        details: {
          format,
          exit_code: Number(code || 0),
        },
      }));
    });
  });

  const src = path.parse(inputPath);
  const ext = format === 'pdf' ? '.pdf' : '.docx';
  const outPath = path.join(outDir, `${src.name}${ext}`);
  try {
    await fs.promises.access(outPath, fs.constants.R_OK);
  } catch {
    throw tenderStageError({
      message: `未找到转换产物: ${outPath}`,
      statusCode: 502,
      code: 'TENDER_FILE_CONVERT_OUTPUT_MISSING',
      category: 'CONVERT',
      retryable: true,
      manualTakeover: buildManualTakeover('请稍后重试，或检查转换环境后重新导出', 'convert'),
    });
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

const buildSimpleDocxBuffer = (paragraphs = [], options = {}) => {
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

  let buffer = ensureDocxHeaderFooterBuffer(
    zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    {
      headerText: trimText(options.headerText),
      footerText: trimText(options.footerText),
    }
  );
  const tocLines = Array.isArray(options.tocLines) ? options.tocLines : [];
  if (tocLines.length) {
    buffer = ensureDocxNativeTocBuffer(buffer, { tocLines });
  }
  const pageBreakTitles = Array.isArray(options.pageBreakTitles) ? options.pageBreakTitles : [];
  if (pageBreakTitles.length) {
    buffer = ensureDocxPageBreakBeforeHeadingsBuffer(buffer, { headings: pageBreakTitles });
  }
  const bodyStartHeading = pageBreakTitles.find((title) => trimText(title) && trimText(title) !== '目录') || '';
  buffer = ensureDocxSectionPageNumberBuffer(buffer, { bodyStartHeading });
  return buffer;
};

const writeSimpleDocx = async ({
  outputPath,
  paragraphs = [],
  headerText = '',
  footerText = '',
  tocLines = [],
  pageBreakTitles = [],
}) => {
  const buffer = buildSimpleDocxBuffer(paragraphs, { headerText, footerText, tocLines, pageBreakTitles });
  await fs.promises.writeFile(outputPath, buffer);
};

const sanitizeExportBaseName = (bid) => {
  const parts = [
    trimText(bid?.bid_no),
    trimText(bid?.project_name),
  ].filter(Boolean);
  const raw = parts.join('-') || `tender-${Number(bid?.id || 0) || Date.now()}`;
  return raw.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 120) || `tender-${Date.now()}`;
};

const resolveBidExportSource = async (bid) => {
  const draft = sanitizeDraftRow(await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [Number(bid.id)]));
  const currentVersion = await getCurrentVersion(bid);
  const sourcePath = trimText(draft?.draft_file_path) || trimText(currentVersion?.storage_path);
  const sourceExt = String(
    trimText(path.extname(sourcePath))
    || trimText(draft?.draft_ext)
    || trimText(currentVersion?.source_ext)
  ).toLowerCase();
  if (!sourcePath || !sourceExt) {
    throw tenderStageError({
      message: '当前标书暂无可导出文件',
      statusCode: 409,
      code: 'TENDER_EXPORT_SOURCE_MISSING',
      category: 'EXPORT',
      retryable: false,
      manualTakeover: buildManualTakeover('请先上传版本文件或生成协同草稿', 'export'),
    });
  }
  return {
    draft,
    currentVersion,
    sourcePath,
    sourceExt: sourceExt.startsWith('.') ? sourceExt : `.${sourceExt}`,
    cleanupPaths: [],
  };
};

const buildBidRiskReportText = async (bid) => {
  const latestRun = await get(
    `SELECT *
     FROM tender_draft_check_runs
     WHERE bid_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(bid.id)]
  );
  const issues = latestRun
    ? await query(
      `SELECT severity, title, message, section_title, requirement_code
       FROM tender_draft_check_issues
       WHERE check_run_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [Number(latestRun.id)]
    )
    : [];
  const lines = [
    `标书编号：${trimText(bid.bid_no) || '-'}`,
    `标书标题：${trimText(bid.title) || '-'}`,
    `项目名称：${trimText(bid.project_name) || '-'}`,
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '风险校验结果',
  ];
  if (!latestRun) {
    lines.push('暂无成稿级校验记录，可先在编制中心执行成稿校验。');
    return lines.join('\n');
  }
  const summary = parseMaybeJson(latestRun.summary_json, {});
  lines.push(`问题总数：${Number(summary.issue_count || 0)}，致命：${Number(summary.fatal_count || 0)}，告警：${Number(summary.warn_count || 0)}`);
  lines.push('');
  if (!issues.length) {
    lines.push('暂无风险问题。');
    return lines.join('\n');
  }
  issues.forEach((item, idx) => {
    lines.push(`${idx + 1}. [${trimText(item.severity) || 'WARN'}] ${trimText(item.title) || '未命名问题'}`);
    lines.push(`   描述：${trimText(item.message) || '-'}`);
    if (trimText(item.section_title)) lines.push(`   章节：${trimText(item.section_title)}`);
    if (trimText(item.requirement_code)) lines.push(`   要求编码：${trimText(item.requirement_code)}`);
  });
  return lines.join('\n');
};

const buildBidExportOutputName = ({ bid, exportType, ext }) => {
  const baseName = sanitizeExportBaseName(bid);
  const suffixMap = {
    DOCX: '-投标文件',
    PDF: '-投标文件',
    PACKAGE: '-导出包',
  };
  return `${baseName}${suffixMap[exportType] || ''}${ext}`;
};

const ensureDocxExportFile = async ({ sourcePath, sourceExt, tempDir }) => {
  const normalizedExt = trimText(sourceExt).toLowerCase();
  if (normalizedExt === '.docx') {
    return copyToManagedPath(sourcePath, EXPORT_ROOT, '.docx');
  }
  if (normalizedExt === '.doc' || normalizedExt === '.pdf') {
    const convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'docx');
    return copyToManagedPath(convertedPath, EXPORT_ROOT, '.docx');
  }
  throw appError(`当前文件类型不支持导出为DOCX: ${normalizedExt || 'unknown'}`, 400);
};

const ensurePdfExportFile = async ({ sourcePath, sourceExt, tempDir }) => {
  const normalizedExt = trimText(sourceExt).toLowerCase();
  if (normalizedExt === '.pdf') {
    return copyToManagedPath(sourcePath, EXPORT_ROOT, '.pdf');
  }
  if (normalizedExt === '.docx' || normalizedExt === '.doc') {
    const convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'pdf');
    return copyToManagedPath(convertedPath, EXPORT_ROOT, '.pdf');
  }
  throw appError(`当前文件类型不支持导出为PDF: ${normalizedExt || 'unknown'}`, 400);
};

const writeBidRiskReportFile = async ({ bid }) => {
  const content = await buildBidRiskReportText(bid);
  const reportPath = path.join(EXPORT_ROOT, buildStoredFilename(`${sanitizeExportBaseName(bid)}-风险报告.txt`, '.txt'));
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.writeFile(reportPath, content, 'utf8');
  return reportPath;
};

const buildPackageBuffer = async ({ fileEntries = [] }) => {
  const zip = new PizZip();
  for (const entry of Array.isArray(fileEntries) ? fileEntries : []) {
    const entryPath = trimText(entry?.path);
    const entryName = trimText(entry?.name);
    if (!entryPath || !entryName) continue;
    const bytes = await fs.promises.readFile(entryPath);
    zip.file(entryName, bytes);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const insertExportRecord = async ({
  bidId,
  versionId = null,
  draftId = null,
  exportType,
  status,
  storagePath = null,
  fileName = null,
  mimeType = null,
  fileSize = 0,
  errorMessage = null,
  payload = {},
  result = {},
  user = null,
}) => {
  const info = await run(
    `INSERT INTO tender_bid_export_records
      (bid_id, version_id, draft_id, export_type, status, storage_path, file_name, mime_type, file_size, error_message, payload_json, result_json, created_by_id, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(bidId),
      Number.isFinite(Number(versionId)) && Number(versionId) > 0 ? Number(versionId) : null,
      Number.isFinite(Number(draftId)) && Number(draftId) > 0 ? Number(draftId) : null,
      trimText(exportType).toUpperCase() || 'DOCX',
      trimText(status).toUpperCase() || 'SUCCESS',
      trimText(storagePath) || null,
      trimText(fileName) || null,
      trimText(mimeType) || null,
      Number(fileSize || 0) || 0,
      trimText(errorMessage) || null,
      stableStringify(payload || {}),
      stableStringify(result || {}),
      Number.isFinite(Number(user?.id)) ? Number(user.id) : null,
      trimText(user?.username) || null,
    ]
  );
  const row = await get('SELECT * FROM tender_bid_export_records WHERE id = ? LIMIT 1', [Number(info.insertId)]);
  return sanitizeExportRecordRow(row);
};

const executeBidExport = async ({ bid, format, user }) => {
  const exportType = trimText(format).toUpperCase();
  if (!['DOCX', 'PDF', 'PACKAGE'].includes(exportType)) throw appError('不支持的导出格式', 400);

  const source = await resolveBidExportSource(bid);
  const sourceDraftId = Number(source?.draft?.id || 0) || null;
  const sourceVersionId = Number(source?.currentVersion?.id || 0) || null;

  try {
    return await withTempDir('bid-export', async (tempDir) => {
      let artifactPath = '';
      let artifactExt = exportType === 'PDF' ? '.pdf' : (exportType === 'PACKAGE' ? '.zip' : '.docx');
      let mimeType = guessMimeByExt(artifactExt);
      const cleanupPaths = [];

      if (exportType === 'DOCX') {
        artifactPath = await ensureDocxExportFile({ sourcePath: source.sourcePath, sourceExt: source.sourceExt, tempDir });
      } else if (exportType === 'PDF') {
        artifactPath = await ensurePdfExportFile({ sourcePath: source.sourcePath, sourceExt: source.sourceExt, tempDir });
      } else {
        const docxPath = await ensureDocxExportFile({ sourcePath: source.sourcePath, sourceExt: source.sourceExt, tempDir });
        const pdfPath = await ensurePdfExportFile({ sourcePath: source.sourcePath, sourceExt: source.sourceExt, tempDir });
        const reportPath = await writeBidRiskReportFile({ bid });
        cleanupPaths.push(docxPath, pdfPath, reportPath);
        const buffer = await buildPackageBuffer({
          fileEntries: [
            { name: buildBidExportOutputName({ bid, exportType: 'DOCX', ext: '.docx' }), path: docxPath },
            { name: buildBidExportOutputName({ bid, exportType: 'PDF', ext: '.pdf' }), path: pdfPath },
            { name: `${sanitizeExportBaseName(bid)}-风险报告.txt`, path: reportPath },
          ],
        });
        artifactPath = path.join(EXPORT_ROOT, buildStoredFilename(buildBidExportOutputName({ bid, exportType: 'PACKAGE', ext: '.zip' }), '.zip'));
        await fs.promises.mkdir(path.dirname(artifactPath), { recursive: true });
        await fs.promises.writeFile(artifactPath, buffer);
      }

      const stat = await readFileStatSafe(artifactPath);
      if (!stat?.isFile()) throw appError('导出产物不存在', 500);

      const fileName = buildBidExportOutputName({ bid, exportType, ext: artifactExt });
      const finalPath = path.join(path.dirname(artifactPath), buildStoredFilename(fileName, artifactExt));
      await fs.promises.copyFile(artifactPath, finalPath);
      if (finalPath !== artifactPath) cleanupPaths.push(artifactPath);

      const record = await insertExportRecord({
        bidId: Number(bid.id),
        versionId: sourceVersionId,
        draftId: sourceDraftId,
        exportType,
        status: 'SUCCESS',
        storagePath: finalPath,
        fileName,
        mimeType,
        fileSize: Number(stat.size || 0),
        payload: {
          format: exportType,
          source_ext: source.sourceExt,
          source_version_id: sourceVersionId,
          source_draft_id: sourceDraftId,
        },
        result: {
          ready: true,
        },
        user,
      });

      if (trimText(bid.status).toUpperCase() === 'EXPORT_READY') {
        await run(
          `UPDATE tender_bids
           SET status = 'EXPORTED', updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
           WHERE id = ?`,
          [Number(user?.id || 0) || null, trimText(user?.username) || null, Number(bid.id)]
        );
      }

      for (const cleanupPath of cleanupPaths) {
        await deleteFileSafe(cleanupPath);
      }

      return record;
    });
  } catch (err) {
    await insertExportRecord({
      bidId: Number(bid.id),
      versionId: sourceVersionId,
      draftId: sourceDraftId,
      exportType,
      status: 'FAILED',
      errorMessage: err?.message || String(err),
      payload: {
        format: exportType,
        source_ext: source.sourceExt,
        source_version_id: sourceVersionId,
        source_draft_id: sourceDraftId,
      },
      result: {
        ready: false,
      },
      user,
    });
    throw err;
  }
};

const buildDocxParagraphXml = (text, options = {}) => {
  const raw = trimText(text);
  if (!raw) return '<w:p/>';
  const {
    headingLevel = 0,
  } = options;
  if (headingLevel === 1) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(raw)}</w:t></w:r></w:p>`;
  }
  if (headingLevel === 2) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(raw)}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(raw)}</w:t></w:r></w:p>`;
};

const buildTemplateReplacementMap = (payload = {}) => ({
  BID_NO: trimText(payload.bid_no),
  PROJECT_TITLE: trimText(payload.project_title),
  PROJECT_NAME: trimText(payload.project_name),
  PROJECT_CODE: trimText(payload.project_code),
  PACKAGE_NO: trimText(payload.package_no),
  BUDGET: trimText(payload.budget),
  BUYER_NAME: trimText(payload.buyer_name),
  AGENCY_NAME: trimText(payload.agency_name),
  PROJECT_DOMAIN: trimText(payload.project_domain),
  PROJECT_OVERVIEW: trimText(payload.project_overview),
  CUSTOMER_NAME: trimText(payload.customer_name),
  SOURCE_FILE_NAME: trimText(payload.source_file_name),
  BID_CATEGORY: trimText(payload.bid_category),
  COMPANY_INFO: trimText(payload.company_info),
  LEGAL_PERSON_INFO: trimText(payload.legal_person_info),
  AUTHORIZED_AGENT_INFO: trimText(payload.authorized_agent_info),
  QUALIFICATION_INFO: trimText(payload.qualification_info),
  FINANCE_INFO: trimText(payload.finance_info),
  PERFORMANCE_INFO: trimText(payload.performance_info),
  PERSONNEL_INFO: trimText(payload.personnel_info),
  BUSINESS_VOLUME_CONTENT: trimText(payload.business_volume_content),
  TECHNICAL_VOLUME_CONTENT: trimText(payload.technical_volume_content),
  QUOTATION_VOLUME_CONTENT: trimText(payload.quotation_volume_content),
  APPENDIX_INDEX_CONTENT: trimText(payload.appendix_index_content),
  HEADER_CONTENT: trimText(payload.header_content),
  FOOTER_CONTENT: trimText(payload.footer_content),
  COVER_CONTENT: trimText(payload.cover_content),
  TOC_CONTENT: trimText(payload.toc_content),
  CHAPTER_OUTLINE: trimText(payload.chapter_outline),
  GENERATED_AT: trimText(payload.generated_at),
});

const isTocChapter = (chapter) => {
  const title = trimText(chapter?.title);
  return trimText(chapter?.slot).toUpperCase() === 'TOC' || /目录/u.test(title);
};

const buildChapterContentText = (chapters = [], options = {}) => {
  const { excludeToc = false } = options;
  const lines = [];
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    if (excludeToc && isTocChapter(chapter)) continue;
    const title = trimText(chapter?.title);
    if (title) lines.push(title);
    const contentLines = Array.isArray(chapter?.content) ? chapter.content : toLines(chapter?.content || '');
    for (const line of contentLines) {
      const normalized = trimText(line);
      if (!normalized) continue;
      lines.push(normalized);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
};

const pickChapterTexts = (chapters = [], keywords = []) => {
  const keywordList = (Array.isArray(keywords) ? keywords : [])
    .map((item) => trimText(item))
    .filter(Boolean);
  if (!keywordList.length) return '';
  const lines = [];
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    const title = trimText(chapter?.title);
    if (!title) continue;
    if (!keywordList.some((keyword) => title.includes(keyword))) continue;
    lines.push(title);
    const contentLines = Array.isArray(chapter?.content) ? chapter.content : toLines(chapter?.content || '');
    for (const line of contentLines) {
      const normalized = trimText(line);
      if (!normalized) continue;
      lines.push(normalized);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
};

const buildTemplateRenderPayload = ({ payload = {}, chapters = [], excludeTocFromChapterContent = false }) => {
  const replacementMap = buildTemplateReplacementMap(payload);
  const chapterContent = buildChapterContentText(chapters, { excludeToc: excludeTocFromChapterContent });
  const coverContent = trimText(payload.cover_content) || pickChapterTexts(chapters, ['封面']);
  const tocContent = trimText(payload.toc_content) || pickChapterTexts(chapters, ['目录']);
  const businessContent = trimText(payload.business_volume_content) || pickChapterTexts(chapters, ['商务']);
  const technicalContent = trimText(payload.technical_volume_content)
    || pickChapterTexts(chapters, ['技术', '服务方案', '采购需求']);
  const quotationContent = trimText(payload.quotation_volume_content)
    || pickChapterTexts(chapters, ['报价', '偏离表']);
  const appendixContent = trimText(payload.appendix_index_content) || pickChapterTexts(chapters, ['附录', '投标文件格式']);
  const chapterOutline = (Array.isArray(chapters) ? chapters : [])
    .map((item, idx) => `${idx + 1}. ${trimText(item?.title) || `章节${idx + 1}`}`)
    .join('\n');

  return {
    ...payload,
    ...replacementMap,
    CHAPTER_COUNT: String((Array.isArray(chapters) ? chapters : []).length),
    CHAPTER_OUTLINE: chapterOutline,
    BID_CONTENT: chapterContent,
    CHAPTERS_CONTENT: chapterContent,
    BID_BODY: chapterContent,
    COVER_CONTENT: coverContent,
    TOC_CONTENT: tocContent,
    BUSINESS_CONTENT: businessContent,
    TECHNICAL_CONTENT: technicalContent,
    QUALIFICATION_CONTENT: trimText(payload.qualification_info) || pickChapterTexts(chapters, ['资格']),
    BUSINESS_VOLUME_CONTENT: businessContent,
    TECHNICAL_VOLUME_CONTENT: technicalContent,
    QUOTATION_VOLUME_CONTENT: quotationContent,
    APPENDIX_INDEX_CONTENT: appendixContent,
    HEADER_CONTENT: trimText(payload.header_content),
    FOOTER_CONTENT: trimText(payload.footer_content),
    COMPANY_INFO: trimText(payload.company_info),
    LEGAL_PERSON_INFO: trimText(payload.legal_person_info),
    AUTHORIZED_AGENT_INFO: trimText(payload.authorized_agent_info),
    QUALIFICATION_INFO: trimText(payload.qualification_info),
    FINANCE_INFO: trimText(payload.finance_info),
    PERFORMANCE_INFO: trimText(payload.performance_info),
    PERSONNEL_INFO: trimText(payload.personnel_info),
    RISK_CONTENT: pickChapterTexts(chapters, ['风险', '丢分']),
    SCORE_CONTENT: pickChapterTexts(chapters, ['得分', '评分']),
    APPENDIX_CONTENT: appendixContent,
  };
};

const appendDocxParagraphsToBody = (documentXml, paragraphXmlRows = []) => {
  const rows = Array.isArray(paragraphXmlRows) ? paragraphXmlRows.filter((item) => trimText(item)) : [];
  if (!rows.length) return documentXml;
  const bodyOpenTag = '<w:body>';
  const bodyCloseTag = '</w:body>';
  const bodyStart = documentXml.indexOf(bodyOpenTag);
  const bodyEnd = documentXml.lastIndexOf(bodyCloseTag);
  if (bodyStart < 0 || bodyEnd <= bodyStart) return documentXml;

  const bodyContentStart = bodyStart + bodyOpenTag.length;
  const bodyXml = documentXml.slice(bodyContentStart, bodyEnd);
  const sectPrRegex = /<w:sectPr[\s\S]*<\/w:sectPr>\s*$/;
  const sectMatch = bodyXml.match(sectPrRegex);
  const existingContent = sectMatch ? bodyXml.slice(0, bodyXml.length - sectMatch[0].length) : bodyXml;
  const sectPrXml = sectMatch ? sectMatch[0] : '';
  const appendixPrefix = existingContent.trim() ? '<w:p/>' : '';
  const appendixBody = `${appendixPrefix}${rows.join('')}`;
  const nextBody = `${existingContent}${appendixBody}${sectPrXml}`;
  return `${documentXml.slice(0, bodyContentStart)}${nextBody}${documentXml.slice(bodyEnd)}`;
};

const buildChapterParagraphXmlRows = (chapters = []) => {
  const paragraphXmlRows = [];
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    const chapterTitle = trimText(chapter?.title);
    if (chapterTitle) paragraphXmlRows.push(buildDocxParagraphXml(chapterTitle, { headingLevel: 1 }));
    const lines = Array.isArray(chapter?.content) ? chapter.content : toLines(chapter?.content || '');
    for (const line of lines) {
      const normalizedLine = trimText(line);
      if (!normalizedLine) {
        paragraphXmlRows.push('<w:p/>');
        continue;
      }
      paragraphXmlRows.push(buildDocxParagraphXml(normalizedLine));
    }
    paragraphXmlRows.push('<w:p/>');
  }
  if (!paragraphXmlRows.length) {
    paragraphXmlRows.push(buildDocxParagraphXml('投标文件（自动生成初稿）', { headingLevel: 1 }));
    paragraphXmlRows.push(buildDocxParagraphXml('请人工完善正文内容。'));
  }
  return paragraphXmlRows;
};

const replaceTemplateTokens = (text, replacementMap = {}) => {
  let result = String(text || '');
  for (const [key, value] of Object.entries(replacementMap || {})) {
    const safe = escapeXml(value || '');
    const token = `{{${key}}}`;
    result = result.split(token).join(safe);
  }
  return result;
};

const writeDocxWithTemplate = ({
  templatePath,
  outputPath,
  chapters = [],
  payload = {},
  tocLines = [],
  pageBreakTitles = [],
}) => {
  return (async () => {
  const bytes = await fs.promises.readFile(templatePath);
  const originalZip = new PizZip(bytes);
  const originalDocXml = originalZip.file('word/document.xml')?.asText() || '';
  if (!trimText(originalDocXml)) {
    throw appError('模板文件缺少 word/document.xml，无法写入内容', 500);
  }
  const chapterRows = Array.isArray(chapters) ? chapters : [];
  const replacementMap = buildTemplateReplacementMap(payload);
  const hasBodyPlaceholder = ['{{BID_CONTENT}}', '{{CHAPTERS_CONTENT}}', '{{BID_BODY}}']
    .some((token) => originalDocXml.includes(token));
  const hasTocPlaceholder = originalDocXml.includes('{{TOC_CONTENT}}');
  const renderPayload = buildTemplateRenderPayload({
    payload: hasTocPlaceholder
      ? { ...payload, toc_content: DOCX_NATIVE_TOC_MARKER }
      : payload,
    chapters: chapterRows,
    excludeTocFromChapterContent: hasTocPlaceholder,
  });

  await applyDocxTemplate({
    sourcePath: templatePath,
    outputPath,
    payload: renderPayload,
  });

  const renderedBytes = await fs.promises.readFile(outputPath);
  const zip = new PizZip(renderedBytes);
  let renderedDocXml = zip.file('word/document.xml')?.asText() || '';
  if (!trimText(renderedDocXml)) {
    throw appError('模板渲染后正文为空，无法生成文档', 500);
  }

  if (!hasBodyPlaceholder) {
    const chapterParagraphRows = buildChapterParagraphXmlRows(
      hasTocPlaceholder ? chapterRows.filter((chapter) => !isTocChapter(chapter)) : chapterRows
    );
    renderedDocXml = appendDocxParagraphsToBody(renderedDocXml, chapterParagraphRows);
    zip.file('word/document.xml', renderedDocXml);
  }

  const replaceInEntries = zip
    .file(/word\/(header|footer)\d*\.xml/)
    .map((entry) => entry.name);
  for (const entryName of replaceInEntries) {
    const content = zip.file(entryName)?.asText();
    if (!content) continue;
    zip.file(entryName, replaceTemplateTokens(content, replacementMap));
  }

  let out = ensureDocxHeaderFooterBuffer(
    zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    {
      headerText: trimText(renderPayload.HEADER_CONTENT),
      footerText: trimText(renderPayload.FOOTER_CONTENT),
    }
  );
  let bodyPlaceholderExpanded = false;
  if (hasBodyPlaceholder) {
    const expandedOut = ensureDocxLogicalParagraphsBuffer(out, {
      splitHints: pageBreakTitles,
      headingLines: pageBreakTitles,
    });
    bodyPlaceholderExpanded = expandedOut !== out;
    out = expandedOut;
  }
  if (!hasBodyPlaceholder || hasTocPlaceholder || bodyPlaceholderExpanded) {
    out = ensureDocxNativeTocBuffer(out, {
      marker: DOCX_NATIVE_TOC_MARKER,
      tocLines,
    });
  }
  if (!hasBodyPlaceholder || bodyPlaceholderExpanded) {
    out = ensureDocxPageBreakBeforeHeadingsBuffer(out, {
      headings: pageBreakTitles,
    });
    const bodyStartHeading = pageBreakTitles.find((title) => trimText(title) && trimText(title) !== '目录') || '';
    out = ensureDocxSectionPageNumberBuffer(out, { bodyStartHeading });
  }
  await fs.promises.writeFile(outputPath, out);
  })();
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
  if (['/api/health', '/api/ready', '/api/version', '/api/build', '/api/metrics'].includes(req.path)) return next();
  if (req.path.startsWith('/api/tender/editor/callback/')) return next();
  if (/^\/api\/tender\/drafts\/\d+\/download\.docx$/.test(req.path)) return next();
  if (/^\/api\/tender\/bids\/generate\/jobs\/\d+\/source\/download\.docx$/.test(req.path)) return next();
  const token = extractBearerToken(req.headers.authorization) || extractCookieToken(req.headers.cookie);
  if (!token) throw appError('未登录', 401);
  if (token.length < 16 || token.length > 4096) throw appError('登录凭证非法', 401);

  const auth = await introspectToken(token);
  req.user = auth.user;
  req.authApps = auth.apps;
  next();
});

const bidMemberRoleSet = new Set(['OWNER', 'COORDINATOR', 'COMPILE', 'TECH', 'BUSINESS', 'FINAL', 'RISK', 'EXPORT']);

const requirePermission = (permission) =>
  asyncHandler(async (req, _res, next) => {
    if (!hasPermission(req.user, permission)) {
      throw appError('无权限', 403);
    }
    next();
  });

const normalizeBidMemberRole = (value) => {
  const normalized = trimText(value).toUpperCase();
  return bidMemberRoleSet.has(normalized) ? normalized : '';
};

const buildBidScopeWhere = (user, { idColumn = 'tender_bids.id', creatorColumn = 'tender_bids.created_by_id' } = {}) => {
  const scope = resolveDataScope(user);
  if (scope === 'ALL') return { sql: '', params: [] };
  if (scope !== 'OWNED_OR_ASSIGNED') return { sql: '0 = 1', params: [] };

  const userId = Number(user?.id);
  const username = trimText(user?.username);
  if (!Number.isFinite(userId) || userId <= 0 || !username) return { sql: '0 = 1', params: [] };

  return {
    sql: `(${creatorColumn} = ? OR EXISTS (
      SELECT 1
      FROM tender_bid_members scope_members
      WHERE scope_members.bid_id = ${idColumn}
        AND (scope_members.member_user_id = ? OR scope_members.member_username = ?)
    ))`,
    params: [userId, userId, username],
  };
};

const buildOwnerScopeWhere = (user, userIdColumn) => {
  const scope = resolveDataScope(user);
  if (scope === 'ALL') return { sql: '', params: [] };
  if (scope !== 'OWNED_OR_ASSIGNED') return { sql: '0 = 1', params: [] };
  const userId = Number(user?.id);
  if (!Number.isFinite(userId) || userId <= 0) return { sql: '0 = 1', params: [] };
  return { sql: `${userIdColumn} = ?`, params: [userId] };
};

const appendScopedWhere = (where, params, scoped) => {
  if (!scoped?.sql) return;
  where.push(scoped.sql);
  if (Array.isArray(scoped.params) && scoped.params.length) params.push(...scoped.params);
};

const loadBidMembersMap = async (bidIds = []) => {
  const ids = Array.from(
    new Set(
      (Array.isArray(bidIds) ? bidIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
  if (!ids.length) return new Map();

  const rows = await query(
    `SELECT *
     FROM tender_bid_members
     WHERE bid_id IN (${ids.map(() => '?').join(',')})
     ORDER BY bid_id ASC, member_role ASC, id ASC`,
    ids
  );

  const map = new Map();
  for (const row of rows) {
    const bidId = Number(row.bid_id);
    if (!map.has(bidId)) map.set(bidId, []);
    map.get(bidId).push(sanitizeBidMemberRow(row));
  }
  return map;
};

const withBidMembers = async (rows = []) => {
  const bidRows = Array.isArray(rows) ? rows.map((row) => sanitizeBidRow(row)) : [];
  const memberMap = await loadBidMembersMap(bidRows.map((row) => row?.id));
  return bidRows.map((row) => ({
    ...row,
    members: memberMap.get(Number(row.id)) || [],
  }));
};

const ensureBidMembers = async ({ bid, members = [], req, tx }) => {
  const bidRow = sanitizeBidRow(bid);
  const ownerUserId = Number(bidRow?.created_by_id || 0);
  const ownerUsername = trimText(bidRow?.created_by_name || req?.user?.username);
  const ownerMember = ownerUsername
    ? {
      member_user_id: Number.isFinite(ownerUserId) && ownerUserId > 0 ? ownerUserId : null,
      member_username: ownerUsername,
      member_role: 'OWNER',
      member_title: '项目负责人',
    }
    : null;

  const normalized = [];
  const seen = new Set();
  const sourceRows = ownerMember ? [ownerMember, ...members] : [...members];
  for (const item of sourceRows) {
    const memberRole = normalizeBidMemberRole(item?.member_role) || 'COORDINATOR';
    const memberUsername = fixMojibakeText(trimText(item?.member_username));
    const memberUserIdNum = Number(item?.member_user_id);
    const memberUserId = Number.isFinite(memberUserIdNum) && memberUserIdNum > 0 ? Math.floor(memberUserIdNum) : null;
    const memberTitle = fixMojibakeText(trimText(item?.member_title));
    if (!memberUsername) continue;
    const dedupeKey = `${memberRole}::${memberUsername}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push({
      member_user_id: memberUserId,
      member_username: memberUsername,
      member_role: memberRole,
      member_title: memberTitle || null,
    });
  }

  await tx.run('DELETE FROM tender_bid_members WHERE bid_id = ?', [Number(bidRow.id)]);
  for (const item of normalized) {
    await tx.run(
      `INSERT INTO tender_bid_members
        (bid_id, member_user_id, member_username, member_role, member_title, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(bidRow.id),
        item.member_user_id,
        item.member_username,
        item.member_role,
        item.member_title,
        Number(req?.user?.id || 0) || null,
        trimText(req?.user?.username) || null,
        Number(req?.user?.id || 0) || null,
        trimText(req?.user?.username) || null,
      ]
    );
  }

  return normalized;
};

app.use(authRequired);

const nextBidNo = async () => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `TB-${day}-`;
  const row = await get('SELECT COUNT(1) AS count FROM tender_bids WHERE bid_no LIKE ?', [`${prefix}%`]);
  const seq = String(Number(row?.count || 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
};

const ensureBidExists = async (bidId, options = {}) => {
  const row = await get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
  if (!row) throw tenderStageError({
    message: '标书不存在',
    statusCode: 404,
    code: 'TENDER_BID_NOT_FOUND',
    category: 'BUSINESS',
    retryable: false,
    manualTakeover: buildManualTakeover('请确认项目是否已被删除或切换到正确项目', 'bid'),
  });
  const user = options?.user || null;
  if (user) {
    const scope = buildBidScopeWhere(user, { idColumn: 'tender_bids.id', creatorColumn: 'tender_bids.created_by_id' });
    if (scope.sql) {
      const allowed = await get(
        `SELECT id
         FROM tender_bids
         WHERE id = ? AND ${scope.sql}
         LIMIT 1`,
        [Number(bidId), ...scope.params]
      );
      if (!allowed) throw bidScopeForbiddenError();
    }
  }
  return sanitizeBidRow(row);
};

const getCurrentVersion = async (bid) => {
  if (!Number.isFinite(Number(bid?.current_version_id))) return null;
  const row = await get('SELECT * FROM tender_bid_versions WHERE id = ? LIMIT 1', [Number(bid.current_version_id)]);
  return sanitizeVersionRow(row);
};

const getBidVersionById = async ({ bidId, versionId }) => {
  if (!Number.isFinite(Number(versionId)) || Number(versionId) <= 0) return null;
  const row = await get(
    `SELECT *
     FROM tender_bid_versions
     WHERE id = ? AND bid_id = ?
     LIMIT 1`,
    [Number(versionId), Number(bidId)]
  );
  return sanitizeVersionRow(row);
};

const getNextVersionNo = async (tx, bidId) => {
  const row = await tx.get('SELECT MAX(version_no) AS max_no FROM tender_bid_versions WHERE bid_id = ?', [bidId]);
  return Number(row?.max_no || 0) + 1;
};

const normalizeParseScope = (value) => {
  const normalized = trimText(value).toUpperCase();
  if (['FULL', 'SCORING', 'PARAMETERS', 'QUALIFICATION'].includes(normalized)) return normalized;
  return 'FULL';
};

const normalizeParseMatchStatus = (value) => {
  const normalized = trimText(value).toUpperCase();
  if (['RECOMMENDED', 'CONFIRMED', 'REPLACED', 'IGNORED'].includes(normalized)) return normalized;
  return '';
};
const PARSE_MATCH_FEEDBACK_STATUS = new Set(['CONFIRMED', 'REPLACED', 'IGNORED']);

const parseScopeTitleMap = {
  FULL: '全量解析',
  SCORING: '仅评分项',
  PARAMETERS: '仅参数表',
  QUALIFICATION: '仅资格项',
};

const parseScopeClauseTypeMap = {
  SCORING: new Set(['SCORING']),
  PARAMETERS: new Set(['TECHNICAL']),
  QUALIFICATION: new Set(['QUALIFICATION']),
};

const parseScopeKeywordMap = {
  SCORING: ['评分', '评审', '分值', '打分'],
  PARAMETERS: ['参数', '技术', '规格', '配置'],
  QUALIFICATION: ['资格', '资质', '业绩', '人员', '证书'],
};

const withTempDir = async (prefix, fn) => {
  const dir = path.join(EDITABLE_ROOT, `${prefix}-${Date.now()}-${crypto.randomUUID()}`);
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
};

const loadSpreadsheetWorkbookFromBuffer = async ({ buffer, sourceExt, sourceName, selectedSheetNames = [] }) => {
  const ext = trimText(sourceExt).toLowerCase();
  if (ext === '.xlsx') {
    return extractSpreadsheetWorkbookFromBuffer(buffer, { sourceName, selectedSheetNames });
  }
  if (ext !== '.xls') {
    return {
      sheet_manifest: [],
      selected_sheet_names: [],
      sheets: [],
      text: '',
    };
  }

  return withTempDir('parse-xls', async (tempDir) => {
    const sourcePath = path.join(tempDir, buildStoredFilename(sourceName || 'sheet.xls', '.xls'));
    await fs.promises.writeFile(sourcePath, buffer);
    const convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'xlsx');
    const bytes = await fs.promises.readFile(convertedPath);
    return extractSpreadsheetWorkbookFromBuffer(bytes, {
      sourceName: sourceName || path.basename(sourcePath),
      selectedSheetNames,
    });
  });
};

const loadSpreadsheetWorkbookFromStoredFile = async ({ sourcePath, sourceExt, sourceName, selectedSheetNames = [] }) => {
  if (!trimText(sourcePath)) {
    return {
      sheet_manifest: [],
      selected_sheet_names: [],
      sheets: [],
      text: '',
    };
  }
  const bytes = await fs.promises.readFile(sourcePath);
  return loadSpreadsheetWorkbookFromBuffer({
    buffer: bytes,
    sourceExt,
    sourceName,
    selectedSheetNames,
  });
};

const buildParseFilePreviewSummary = (workbook) => {
  const sheetManifest = Array.isArray(workbook?.sheet_manifest) ? workbook.sheet_manifest : [];
  const selectedSheetNames = Array.isArray(workbook?.selected_sheet_names) ? workbook.selected_sheet_names : [];
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const totalRows = sheets.reduce((sum, item) => sum + Number(item?.row_count || 0), 0);
  return {
    sheet_count: sheetManifest.length,
    selected_sheet_count: selectedSheetNames.length,
    selected_sheet_names: selectedSheetNames,
    total_rows: totalRows,
  };
};

const buildParseKeywordTokens = (value) => {
  const tokens = new Set();
  const text = String(value || '').toLowerCase();
  const chineseParts = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  chineseParts.forEach((item) => tokens.add(item));
  const wordParts = text.match(/[a-z0-9]{2,}/g) || [];
  wordParts.forEach((item) => tokens.add(item));
  return Array.from(tokens);
};

const scoreKeywordOverlap = (baseTokens = [], candidateTokens = []) => {
  if (!baseTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  let matched = 0;
  for (const token of baseTokens) {
    if (candidateSet.has(token)) matched += 1;
  }
  return matched / Math.max(baseTokens.length, 1);
};

const scopeMatchesTable = (scope, table) => {
  if (scope === 'FULL') return true;
  const keywords = parseScopeKeywordMap[scope] || [];
  if (!keywords.length) return true;
  const target = trimText([
    table?.table_name,
    table?.source_sheet_name,
    table?.summary,
    Array.isArray(table?.header) ? table.header.join(' ') : '',
  ].join(' '));
  return keywords.some((item) => target.includes(item));
};

const filterClausesByParseScope = (scope, clauses = []) => {
  if (scope === 'FULL') return clauses;
  const typeSet = parseScopeClauseTypeMap[scope];
  const filtered = (Array.isArray(clauses) ? clauses : []).filter((item) => typeSet?.has(trimText(item?.clause_type).toUpperCase()));
  return filtered.length ? filtered : clauses;
};

const filterTablesByParseScope = (scope, tables = []) => {
  if (scope === 'FULL') return tables;
  const filtered = (Array.isArray(tables) ? tables : []).filter((item) => scopeMatchesTable(scope, item));
  return filtered.length ? filtered : tables;
};

const loadParseFilesByBidId = async (bidId, options = {}) => {
  const includeDeleted = normalizeBoolean(options.includeDeleted, false);
  const where = ['bid_id = ?'];
  const params = [Number(bidId)];
  if (!includeDeleted) {
    where.push(`status <> 'DELETED'`);
  }
  const rows = await query(
    `SELECT *
     FROM tender_bid_parse_files
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(root_file_id, id) ASC, source_depth ASC, id ASC`,
    params
  );
  return rows.map((row) => sanitizeParseFileRow(row));
};

const loadLatestParseJobRow = async (bidId) => {
  const row = await get(
    `SELECT *
     FROM tender_bid_parse_jobs
     WHERE bid_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(bidId)]
  );
  return sanitizeParseJobRow(row);
};

const loadParseJobDetail = async (jobId, options = {}) => {
  const parsedJobId = Number(jobId);
  if (!Number.isFinite(parsedJobId) || parsedJobId <= 0) return null;
  const where = ['id = ?'];
  const params = [parsedJobId];
  if (Number.isFinite(Number(options.bidId)) && Number(options.bidId) > 0) {
    where.push('bid_id = ?');
    params.push(Number(options.bidId));
  }
  const job = sanitizeParseJobRow(await get(
    `SELECT *
     FROM tender_bid_parse_jobs
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    params
  ));
  if (!job) return null;

  const [clauses, tables, matches] = await Promise.all([
    query(
      `SELECT *
       FROM tender_bid_parse_clauses
       WHERE parse_job_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [parsedJobId]
    ),
    query(
      `SELECT *
       FROM tender_bid_parse_tables
       WHERE parse_job_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [parsedJobId]
    ),
    query(
      `SELECT m.*, c.clause_title, c.clause_text, a.original_file_name AS asset_file_name
       FROM tender_bid_parse_matches m
       LEFT JOIN tender_bid_parse_clauses c ON c.id = m.clause_id
       LEFT JOIN tender_assets a ON a.id = m.asset_id
       WHERE m.parse_job_id = ?
       ORDER BY m.clause_id ASC, m.id ASC`,
      [parsedJobId]
    ),
  ]);

  return {
    job,
    clauses: clauses.map((row) => sanitizeParseClauseRow(row)),
    tables: tables.map((row) => sanitizeParseTableRow(row)),
    matches: matches.map((row) => ({
      ...sanitizeParseMatchRow(row),
      clause_title: fixMojibakeText(row.clause_title),
      clause_text: fixMojibakeText(row.clause_text),
      asset_file_name: fixMojibakeText(row.asset_file_name),
    })),
  };
};

const loadBidParseWorkspace = async (bidId) => {
  const files = await loadParseFilesByBidId(bidId);
  const latestJob = await loadLatestParseJobRow(bidId);
  const detail = latestJob ? await loadParseJobDetail(latestJob.id, { bidId }) : null;
  return {
    bid_id: Number(bidId),
    files,
    latest_job: detail?.job || null,
    project_fields: {
      values: detail?.job?.merged_fields || {},
      sources: detail?.job?.field_sources || {},
    },
    clauses: detail?.clauses || [],
    tables: detail?.tables || [],
    matches: detail?.matches || [],
    constants: {
      file_roles: parseWorkspaceConstants.SUPPORTED_PARSE_FILE_ROLES,
      parse_scopes: Object.entries(parseScopeTitleMap).map(([value, label]) => ({ value, label })),
    },
  };
};

const buildBidKbIngestSourceFile = (bidId) => `bid:${Number(bidId)}`;

const normalizeKbDateTime = (value) => {
  const normalized = normalizeDateTimeInput(value);
  return normalized || null;
};

const loadLinkedKbProjectByBid = async (bid = {}) => {
  const linkedId = Number(bid?.source_kb_project_id || 0);
  if (linkedId > 0) {
    const linked = sanitizeKbProjectRow(await get('SELECT * FROM kb_projects WHERE id = ? LIMIT 1', [linkedId]));
    if (linked) return linked;
  }
  const fallback = sanitizeKbProjectRow(await get(
    `SELECT *
     FROM kb_projects
     WHERE source_bid_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(bid?.id || 0)]
  ));
  return fallback;
};

const loadWinningStrategyInputs = async ({ limit = 40 } = {}) => {
  const cappedLimit = Math.max(1, Math.min(80, Number(limit || 0) || 40));
  const projectRows = (await query(
    `SELECT *
     FROM kb_projects
     WHERE result_status = 'WON'
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [cappedLimit]
  )).map((row) => sanitizeKbProjectRow(row));
  const projectIds = projectRows.map((item) => Number(item.id)).filter((value) => Number.isFinite(value) && value > 0);
  if (!projectIds.length) {
    return {
      kbProjects: [],
      kbScoreItems: [],
      kbSectionAssets: [],
    };
  }

  const [kbScoreItems, kbSectionAssets] = await Promise.all([
    query(
      `SELECT *
       FROM kb_score_items
       WHERE kb_project_id IN (${projectIds.map(() => '?').join(',')})
       ORDER BY full_score DESC, id DESC`,
      projectIds
    ),
    query(
      `SELECT *
       FROM kb_section_assets
       WHERE kb_project_id IN (${projectIds.map(() => '?').join(',')}) AND status = 'ACTIVE'
       ORDER BY quality_score DESC, id DESC`,
      projectIds
    ),
  ]);

  return {
    kbProjects: projectRows,
    kbScoreItems,
    kbSectionAssets,
  };
};

const loadBidAssetOcrRows = async (bidId) => {
  const rows = await query(
    `SELECT a.*, r.ocr_text, r.fields_json
     FROM tender_assets a
     LEFT JOIN tender_asset_ocr_results r
       ON r.id = (
         SELECT rr.id
         FROM tender_asset_ocr_results rr
         WHERE rr.asset_id = a.id
         ORDER BY rr.id DESC
         LIMIT 1
       )
     WHERE a.bid_id = ?
     ORDER BY a.id ASC`,
    [Number(bidId)]
  );
  return rows.map((row) => ({
    ...sanitizeAssetRow(row),
    ocr_text: fixMojibakeText(row.ocr_text),
    fields_json: parseMaybeJson(row.fields_json, {}),
  }));
};

const buildKbClauseTags = (projectTags = [], clause = {}) => normalizeTagList([
  ...projectTags,
  trimText(clause?.clause_type) ? `clause-${trimText(clause.clause_type).toLowerCase()}` : '',
  Number(clause?.scoring_flag || 0) > 0 ? 'clause-scoring' : '',
  Number(clause?.mandatory_flag || 0) > 0 ? 'clause-mandatory' : '',
  trimText(clause?.response_mode) ? `response-${trimText(clause.response_mode).toLowerCase()}` : '',
]);

const buildKbSectionTags = (projectTags = [], section = {}) => normalizeTagList([
  ...projectTags,
  trimText(section?.section_title) ? `section-${trimText(section.section_title)}` : 'section-paragraph',
]);

const loadKbProjectStats = async (kbProjectId) => {
  const safeProjectId = Number(kbProjectId || 0);
  if (!safeProjectId) {
    return {
      clause_count: 0,
      score_item_count: 0,
      section_asset_count: 0,
      chunk_count: 0,
      attachment_chunk_count: 0,
    };
  }
  const [clauses, scoreItems, sections, chunks, attachmentChunks] = await Promise.all([
    get('SELECT COUNT(1) AS count FROM kb_tender_clauses WHERE kb_project_id = ?', [safeProjectId]),
    get('SELECT COUNT(1) AS count FROM kb_score_items WHERE kb_project_id = ?', [safeProjectId]),
    get('SELECT COUNT(1) AS count FROM kb_section_assets WHERE kb_project_id = ?', [safeProjectId]),
    get('SELECT COUNT(1) AS count FROM kb_asset_chunks WHERE kb_project_id = ?', [safeProjectId]),
    get(
      `SELECT COUNT(1) AS count
       FROM kb_asset_chunks
       WHERE kb_project_id = ? AND chunk_type = 'ATTACHMENT_OCR'`,
      [safeProjectId]
    ),
  ]);
  return {
    clause_count: Number(clauses?.count || 0),
    score_item_count: Number(scoreItems?.count || 0),
    section_asset_count: Number(sections?.count || 0),
    chunk_count: Number(chunks?.count || 0),
    attachment_chunk_count: Number(attachmentChunks?.count || 0),
  };
};

const loadBidKbWorkspace = async ({ bid, user }) => {
  const safeBid = bid || await ensureBidExists(Number(user?.bidId || 0), { user });
  const latestParseJob = await loadLatestParseJobRow(Number(safeBid.id));
  const parseDetail = latestParseJob ? await loadParseJobDetail(latestParseJob.id, { bidId: Number(safeBid.id) }) : null;
  const currentVersion = await getCurrentVersion(safeBid);
  const sectionRows = currentVersion ? await loadDraftSectionRegistryRows({ bidId: Number(safeBid.id), versionId: Number(currentVersion.id) }) : [];
  const attachmentRows = await loadBidAssetOcrRows(Number(safeBid.id));
  const linkedProject = await loadLinkedKbProjectByBid(safeBid);
  const ingestJobs = (await query(
    `SELECT *
     FROM kb_ingest_jobs
     WHERE job_type = 'BID_PROJECT_INGEST' AND source_file = ?
     ORDER BY id DESC
     LIMIT 10`,
    [buildBidKbIngestSourceFile(safeBid.id)]
  )).map((row) => sanitizeKbIngestJobRow(row));

  const derivedDefaults = buildKbProjectRecord({
    bid: safeBid,
    latestParseJob,
    overrides: {},
    user: user || {},
  });
  const defaultTags = Array.isArray(derivedDefaults.tags) ? derivedDefaults.tags : [];
  const projectRecordForEstimate = {
    id: Number(linkedProject?.id || safeBid.id),
    project_name: trimText(linkedProject?.project_name || derivedDefaults.project_name),
    purchaser: trimText(linkedProject?.purchaser || derivedDefaults.purchaser),
    project_type: trimText(linkedProject?.project_type || derivedDefaults.project_type),
    industry_type: trimText(linkedProject?.industry_type || derivedDefaults.industry_type),
    remarks: trimText(linkedProject?.remarks || derivedDefaults.remarks),
    tags: Array.isArray(parseMaybeJson(linkedProject?.tags_json, null))
      ? parseMaybeJson(linkedProject?.tags_json, [])
      : defaultTags,
  };
  const estimatedChunks = buildKbAssetChunks({
    kbProjectId: Number(linkedProject?.id || safeBid.id),
    project: projectRecordForEstimate,
    clauses: parseDetail?.clauses || [],
    sections: sectionRows.map((row) => ({
      id: Number(row.id),
      section_title: row.section_title,
      paragraph_text: row.paragraph_text,
    })),
    tables: parseDetail?.tables || [],
    attachments: attachmentRows,
  });
  const projectStats = await loadKbProjectStats(linkedProject?.id);

  return {
    bid: safeBid,
    linked_project: linkedProject,
    latest_parse_job: parseDetail?.job || null,
    ingest_jobs: ingestJobs,
    defaults: {
      project_name: trimText(linkedProject?.project_name || derivedDefaults.project_name),
      project_no: trimText(linkedProject?.project_no || derivedDefaults.project_no),
      purchaser: trimText(linkedProject?.purchaser || derivedDefaults.purchaser),
      project_type: trimText(linkedProject?.project_type || derivedDefaults.project_type),
      industry_type: trimText(linkedProject?.industry_type || derivedDefaults.industry_type),
      region: trimText(linkedProject?.region || derivedDefaults.region),
      result_status: trimText(linkedProject?.result_status || derivedDefaults.result_status || 'IN_PROGRESS'),
      bid_amount: linkedProject?.bid_amount ?? derivedDefaults.bid_amount ?? '',
      tags: Array.isArray(parseMaybeJson(linkedProject?.tags_json, null))
        ? parseMaybeJson(linkedProject?.tags_json, [])
        : defaultTags,
      remarks: trimText(linkedProject?.remarks || derivedDefaults.remarks),
    },
    stats: {
      ingestable_clauses: Number(parseDetail?.clauses?.length || 0),
      ingestable_score_items: Number(buildKbScoreItemRows({
        kbProjectId: Number(linkedProject?.id || safeBid.id),
        clauses: parseDetail?.clauses || [],
      }).length),
      ingestable_sections: Number(sectionRows.length || 0),
      ingestable_tables: Number(parseDetail?.tables?.length || 0),
      ingestable_attachments: Number(attachmentRows.length || 0),
      estimated_chunk_count: Number(estimatedChunks.length || 0),
      ...projectStats,
    },
  };
};

const buildKbProjectNoFallback = ({ projectNo, bid }) => {
  const base = trimText(projectNo);
  const bidNo = trimText(bid?.bid_no) || (Number.isFinite(Number(bid?.id)) && Number(bid.id) > 0 ? `BID-${Number(bid.id)}` : '');
  if (!base) return bidNo ? bidNo.slice(0, 128) : null;
  if (!bidNo) return base.slice(0, 128);
  const next = base.includes(bidNo) ? base : `${base}-${bidNo}`;
  return next.slice(0, 128);
};

const resolveKbProjectNoForIngest = async ({ tx, projectNo, bid, currentProjectId = 0 }) => {
  const desiredProjectNo = trimText(projectNo) || trimText(bid?.bid_no) || '';
  if (!desiredProjectNo) return null;

  const existing = await tx.get(
    `SELECT id, source_bid_id
     FROM kb_projects
     WHERE project_no = ?
     LIMIT 1`,
    [desiredProjectNo]
  );
  if (!existing || Number(existing.id) === Number(currentProjectId || 0) || Number(existing.source_bid_id || 0) === Number(bid?.id || 0)) {
    return desiredProjectNo.slice(0, 128);
  }

  const fallback = buildKbProjectNoFallback({ projectNo: desiredProjectNo, bid });
  if (fallback) {
    const fallbackExisting = await tx.get(
      `SELECT id, source_bid_id
       FROM kb_projects
       WHERE project_no = ?
       LIMIT 1`,
      [fallback]
    );
    if (!fallbackExisting || Number(fallbackExisting.id) === Number(currentProjectId || 0) || Number(fallbackExisting.source_bid_id || 0) === Number(bid?.id || 0)) {
      return fallback;
    }
  }

  return `${String(fallback || desiredProjectNo).slice(0, 108)}-ID${Number(bid?.id || 0)}`.slice(0, 128);
};

const runBidKbIngest = async ({
  bid,
  user,
  overrides = {},
}) => {
  const latestParseJob = await loadLatestParseJobRow(Number(bid.id));
  if (!latestParseJob || Number(latestParseJob?.id || 0) <= 0) {
    throw tenderStageError({
      message: '请先完成项目解析后再执行知识库沉淀',
      statusCode: 409,
      code: 'TENDER_KB_INGEST_PARSE_REQUIRED',
      category: 'BUSINESS',
      manualTakeover: buildManualTakeover('先在项目解析工作台完成解析，再执行知识库沉淀', 'kb_ingest'),
    });
  }

  const parseDetail = await loadParseJobDetail(latestParseJob.id, { bidId: Number(bid.id) });
  if (!parseDetail || (!parseDetail.clauses.length && !parseDetail.tables.length)) {
    throw tenderStageError({
      message: '当前项目缺少可沉淀的解析结果',
      statusCode: 409,
      code: 'TENDER_KB_INGEST_EMPTY_PARSE_RESULT',
      category: 'BUSINESS',
      manualTakeover: buildManualTakeover('请确认解析结果包含条款或表格后再入库', 'kb_ingest'),
    });
  }

  const currentVersion = await getCurrentVersion(bid);
  const sectionRows = currentVersion
    ? await loadDraftSectionRegistryRows({ bidId: Number(bid.id), versionId: Number(currentVersion.id) })
    : [];
  const attachmentRows = await loadBidAssetOcrRows(Number(bid.id));
  const parseFiles = await loadParseFilesByBidId(Number(bid.id), { includeDeleted: false });
  const parseFileMap = new Map(parseFiles.map((item) => [Number(item.id), item]));
  const ingestInput = {
    source_bid_id: Number(bid.id),
    parse_job_id: Number(latestParseJob.id),
    version_id: Number(currentVersion?.id || 0) || null,
    overrides: isPlainObject(overrides) ? overrides : {},
  };
  const ingestSource = buildBidKbIngestSourceFile(bid.id);
  const sourceHash = crypto.createHash('sha256').update(stableStringify(ingestInput)).digest('hex');
  const jobInsert = await run(
    `INSERT INTO kb_ingest_jobs
      (job_type, source_file, source_hash, status, input_payload, operator_id, operator_name)
     VALUES ('BID_PROJECT_INGEST', ?, ?, 'RUNNING', ?, ?, ?)`,
    [
      ingestSource,
      sourceHash,
      JSON.stringify(ingestInput),
      Number(user?.id || 0) || null,
      trimText(user?.username) || null,
    ]
  );
  const jobId = Number(jobInsert.insertId);

  try {
    const result = await transaction(async (tx) => {
      const existingProject = sanitizeKbProjectRow(await tx.get(
        `SELECT *
         FROM kb_projects
         WHERE source_bid_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [Number(bid.id)]
      ));
      const projectRecord = buildKbProjectRecord({
        bid,
        latestParseJob,
        overrides,
        user,
      });
      projectRecord.publish_date = normalizeKbDateTime(projectRecord.publish_date);
      projectRecord.bid_deadline = normalizeKbDateTime(projectRecord.bid_deadline);

      let kbProjectId = Number(existingProject?.id || 0);
      projectRecord.project_no = await resolveKbProjectNoForIngest({
        tx,
        projectNo: projectRecord.project_no,
        bid,
        currentProjectId: kbProjectId,
      });
      if (kbProjectId > 0) {
        await tx.run(
          `UPDATE kb_projects
           SET project_name = ?, project_no = ?, purchaser = ?, industry_type = ?, project_type = ?, region = ?,
               publish_date = ?, bid_deadline = ?, result_status = ?, bid_amount = ?, source_bid_id = ?, tags_json = ?,
               remarks = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
           WHERE id = ?`,
          [
            projectRecord.project_name,
            projectRecord.project_no || null,
            projectRecord.purchaser || null,
            projectRecord.industry_type || null,
            projectRecord.project_type || null,
            projectRecord.region || null,
            projectRecord.publish_date,
            projectRecord.bid_deadline,
            projectRecord.result_status || 'IN_PROGRESS',
            projectRecord.bid_amount,
            projectRecord.source_bid_id,
            JSON.stringify(projectRecord.tags || []),
            projectRecord.remarks || null,
            Number(user?.id || 0) || null,
            trimText(user?.username) || null,
            kbProjectId,
          ]
        );
      } else {
        const inserted = await tx.run(
          `INSERT INTO kb_projects
            (project_name, project_no, purchaser, industry_type, project_type, region, publish_date, bid_deadline,
             result_status, bid_amount, source_bid_id, tags_json, remarks, created_by_id, created_by_name, updated_by_id, updated_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectRecord.project_name,
            projectRecord.project_no || null,
            projectRecord.purchaser || null,
            projectRecord.industry_type || null,
            projectRecord.project_type || null,
            projectRecord.region || null,
            projectRecord.publish_date,
            projectRecord.bid_deadline,
            projectRecord.result_status || 'IN_PROGRESS',
            projectRecord.bid_amount,
            projectRecord.source_bid_id,
            JSON.stringify(projectRecord.tags || []),
            projectRecord.remarks || null,
            Number(user?.id || 0) || null,
            trimText(user?.username) || null,
            Number(user?.id || 0) || null,
            trimText(user?.username) || null,
          ]
        );
        kbProjectId = Number(inserted.insertId);
      }

      await tx.run('DELETE FROM kb_asset_chunks WHERE kb_project_id = ?', [kbProjectId]);
      await tx.run('DELETE FROM kb_section_assets WHERE kb_project_id = ?', [kbProjectId]);
      await tx.run('DELETE FROM kb_score_items WHERE kb_project_id = ?', [kbProjectId]);
      await tx.run('DELETE FROM kb_tender_clauses WHERE kb_project_id = ?', [kbProjectId]);

      const projectTags = Array.isArray(projectRecord.tags) ? projectRecord.tags : [];
      const runtimeClauseIdToKbId = new Map();
      for (const clause of parseDetail.clauses || []) {
        const sourceFile = parseFileMap.get(Number(clause.source_file_id || 0));
        const inserted = await tx.run(
          `INSERT INTO kb_tender_clauses
            (kb_project_id, clause_no, chapter_name, source_text, clause_type, is_mandatory, is_scoring_item, score_value,
             response_mode, risk_level, source_page, source_position, source_file_path, tags_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            kbProjectId,
            trimText(clause.clause_code) || null,
            trimText(clause.clause_title) || null,
            trimText(clause.clause_text),
            trimText(clause.clause_type) || null,
            Number(clause.mandatory_flag || 0) > 0 ? 1 : 0,
            Number(clause.scoring_flag || 0) > 0 ? 1 : 0,
            Number.isFinite(Number(clause.score_value)) ? Number(clause.score_value) : null,
            trimText(clause.response_mode) || null,
            Number(clause.mandatory_flag || 0) > 0 ? 'HIGH' : (Number(clause.scoring_flag || 0) > 0 ? 'MEDIUM' : 'LOW'),
            null,
            trimText(clause?.metadata?.relative_path || sourceFile?.relative_path || sourceFile?.display_name) || null,
            trimText(sourceFile?.storage_path) || null,
            JSON.stringify(buildKbClauseTags(projectTags, clause)),
          ]
        );
        runtimeClauseIdToKbId.set(Number(clause.id), Number(inserted.insertId));
      }

      const scoreRows = buildKbScoreItemRows({
        kbProjectId,
        clauses: parseDetail.clauses || [],
      });
      for (const item of scoreRows) {
        await tx.run(
          `INSERT INTO kb_score_items
            (kb_project_id, item_name, full_score, scoring_rule, recommended_response_points, priority_level, source_clause_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            kbProjectId,
            trimText(item.item_name),
            Number(item.full_score || 0),
            trimText(item.scoring_rule) || null,
            JSON.stringify(Array.isArray(item.recommended_response_points) ? item.recommended_response_points : []),
            trimText(item.priority_level) || null,
            runtimeClauseIdToKbId.get(Number(item.source_clause_id || 0)) || null,
          ]
        );
      }

      const sectionIdMap = new Map();
      for (const section of sectionRows) {
        const tags = buildKbSectionTags(projectTags, section);
        const inserted = await tx.run(
          `INSERT INTO kb_section_assets
            (kb_project_id, section_name, sub_section_name, content, quality_score, reusable_flag, applicable_scene,
             industry_type, project_type, tags_json, source_file_path, source_clause_id, source_score_item_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'ACTIVE')`,
          [
            kbProjectId,
            trimText(section.section_title) || '正文',
            trimText(section.template_slot) || null,
            trimText(section.paragraph_text),
            0.9,
            1,
            trimText(section.section_title) || null,
            projectRecord.industry_type || null,
            projectRecord.project_type || null,
            JSON.stringify(tags),
            trimText(currentVersion?.storage_path) || null,
          ]
        );
        const kbSectionAssetId = Number(inserted.insertId);
        sectionIdMap.set(Number(section.id), kbSectionAssetId);
        await tx.run(
          `UPDATE tender_draft_section_registry
           SET source_kb_section_asset_id = ?
           WHERE id = ?`,
          [kbSectionAssetId, Number(section.id)]
        );
      }

      const chunkRows = buildKbAssetChunks({
        kbProjectId,
        project: {
          id: kbProjectId,
          project_name: projectRecord.project_name,
          purchaser: projectRecord.purchaser,
          project_type: projectRecord.project_type,
          industry_type: projectRecord.industry_type,
          remarks: projectRecord.remarks,
          tags: projectRecord.tags,
        },
        clauses: (parseDetail.clauses || []).map((clause) => ({
          ...clause,
          id: runtimeClauseIdToKbId.get(Number(clause.id || 0)) || clause.id,
        })),
        sections: sectionRows.map((section) => ({
          id: sectionIdMap.get(Number(section.id)) || section.id,
          section_title: section.section_title,
          paragraph_text: section.paragraph_text,
        })),
        tables: parseDetail.tables || [],
        attachments: attachmentRows,
      });

      for (const chunk of chunkRows) {
        await tx.run(
          `INSERT INTO kb_asset_chunks
            (asset_type, source_table, source_id, kb_project_id, section_name, sub_section_name, chunk_type,
             chunk_text, tags_json, embedding_status, embedding_model, embedding_vector_ref, quality_score, reusable_flag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, ?)`,
          [
            trimText(chunk.asset_type) || 'GENERIC_ASSET',
            trimText(chunk.source_table),
            Number(chunk.source_id || 0) || 0,
            kbProjectId,
            trimText(chunk.section_name) || null,
            trimText(chunk.sub_section_name) || null,
            trimText(chunk.chunk_type) || 'PROJECT_SUMMARY',
            trimText(chunk.chunk_text),
            JSON.stringify(Array.isArray(chunk.tags) ? chunk.tags : []),
            Number(chunk.quality_score || 0) || 0,
            Number(chunk.reusable_flag || 0) > 0 ? 1 : 0,
          ]
        );
      }

      await tx.run(
        `UPDATE tender_bids
         SET source_kb_project_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [kbProjectId, Number(user?.id || 0) || null, trimText(user?.username) || null, Number(bid.id)]
      );

      return {
        kb_project_id: kbProjectId,
        summary: {
          kb_project_id: kbProjectId,
          clause_count: Number(parseDetail.clauses?.length || 0),
          score_item_count: Number(scoreRows.length || 0),
          section_asset_count: Number(sectionRows.length || 0),
          chunk_count: Number(chunkRows.length || 0),
          attachment_count: Number(attachmentRows.length || 0),
        },
      };
    });

    await run(
      `UPDATE kb_ingest_jobs
       SET status = 'SUCCESS', output_summary = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(result.summary || {}), jobId]
    );

    return {
      job_id: jobId,
      kb_project_id: result.kb_project_id,
      summary: result.summary || {},
    };
  } catch (err) {
    await run(
      `UPDATE kb_ingest_jobs
       SET status = 'FAILED', error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [trimText(err?.message || '知识库沉淀失败').slice(0, 1000), jobId]
    );
    throw err;
  }
};

const uniqueTextList = (values = []) => {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const text = trimText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
};

const buildEvaluationDatasetCode = () => `EVAL-DS-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const buildEvaluationRunNo = () => `EVAL-RUN-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const normalizeEvaluationExpectedPayload = (evalType, payload = {}) => {
  const safe = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (evalType === 'CLAUSE_RECOGNITION') {
    return {
      clause_count: Math.max(0, Number(safe.clause_count || 0)),
      mandatory_count: Math.max(0, Number(safe.mandatory_count || 0)),
      scoring_count: Math.max(0, Number(safe.scoring_count || 0)),
      clause_types: uniqueTextList(safe.clause_types),
    };
  }
  if (evalType === 'SCORE_COVERAGE') {
    return {
      score_item_names: uniqueTextList(safe.score_item_names),
      recommended_points: uniqueTextList(safe.recommended_points),
    };
  }
  if (evalType === 'MATERIAL_MATCHING') {
    return {
      required_asset_ids: uniqueTextList(safe.required_asset_ids),
    };
  }
  if (evalType === 'RISK_RECALL') {
    return {
      risk_codes: uniqueTextList(safe.risk_codes),
      high_risk_codes: uniqueTextList(safe.high_risk_codes),
    };
  }
  if (evalType === 'EXPORT_COMPLETENESS') {
    return {
      required_deliverables: uniqueTextList(safe.required_deliverables),
    };
  }
  return {};
};

const buildVisibleEvaluationDatasetWhere = (user, filters = {}) => {
  const where = [];
  const params = [];

  if (trimText(filters.evalType)) {
    where.push('d.eval_type = ?');
    params.push(normalizeEvaluationType(filters.evalType));
  }
  if (filters.baselineFlag !== undefined && filters.baselineFlag !== null && filters.baselineFlag !== '') {
    where.push('d.baseline_flag = ?');
    params.push(Number(filters.baselineFlag) ? 1 : 0);
  }
  if (trimText(filters.status)) {
    where.push('d.status = ?');
    params.push(trimText(filters.status).toUpperCase());
  }
  if (Array.isArray(filters.datasetIds) && filters.datasetIds.length) {
    const ids = Array.from(new Set(filters.datasetIds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)));
    if (!ids.length) {
      where.push('1 = 0');
    } else {
      where.push(`d.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  appendScopedWhere(where, params, buildBidScopeWhere(user, {
    idColumn: 'b.id',
    creatorColumn: 'b.created_by_id',
  }));
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
};

const listVisibleEvaluationDatasets = async ({ user, filters = {}, limit = 200 } = {}) => {
  const { whereSql, params } = buildVisibleEvaluationDatasetWhere(user, filters);
  const take = Math.min(2000, Math.max(1, Number(limit || 200)));
  const rows = await query(
    `SELECT d.*, b.title AS bid_title, b.project_name AS bid_project_name, b.status AS bid_status
     FROM tender_eval_datasets d
     JOIN tender_bids b ON b.id = d.source_bid_id
     ${whereSql}
     ORDER BY d.id DESC
     LIMIT ?`,
    [...params, take]
  );
  return rows.map((row) => ({
    ...sanitizeEvaluationDatasetRow(row),
    bid_title: fixMojibakeText(row.bid_title),
    bid_project_name: fixMojibakeText(row.bid_project_name),
    bid_status: trimText(row.bid_status).toUpperCase(),
  }));
};

const buildVisibleEvaluationScope = (user) => buildBidScopeWhere(user, {
  idColumn: 'b.id',
  creatorColumn: 'b.created_by_id',
});

const listVisibleEvaluationRuns = async ({ user, limit = 100 } = {}) => {
  const scoped = buildVisibleEvaluationScope(user);
  const take = Math.min(2000, Math.max(1, Number(limit || 100)));
  const rows = await query(
    `SELECT DISTINCT r.*
     FROM tender_eval_runs r
     JOIN tender_eval_run_items i ON i.run_id = r.id
     JOIN tender_eval_datasets d ON d.id = i.dataset_id
     JOIN tender_bids b ON b.id = d.source_bid_id
     ${scoped.sql ? `WHERE ${scoped.sql}` : ''}
     ORDER BY r.id DESC
     LIMIT ?`,
    [...scoped.params, take]
  );
  return rows.map((row) => sanitizeEvaluationRunRow(row));
};

const loadVisibleEvaluationRunDetail = async ({ user, runId }) => {
  const scoped = buildVisibleEvaluationScope(user);
  const run = sanitizeEvaluationRunRow(await get(
    `SELECT DISTINCT r.*
     FROM tender_eval_runs r
     JOIN tender_eval_run_items i ON i.run_id = r.id
     JOIN tender_eval_datasets d ON d.id = i.dataset_id
     JOIN tender_bids b ON b.id = d.source_bid_id
     WHERE r.id = ?
       ${scoped.sql ? `AND (${scoped.sql})` : ''}
     LIMIT 1`,
    [Number(runId), ...scoped.params]
  ));
  if (!run) return null;

  const itemRows = await query(
    `SELECT i.*, d.dataset_code, d.dataset_name
     FROM tender_eval_run_items i
     JOIN tender_eval_datasets d ON d.id = i.dataset_id
     JOIN tender_bids b ON b.id = d.source_bid_id
     WHERE i.run_id = ?
       ${scoped.sql ? `AND (${scoped.sql})` : ''}
     ORDER BY i.id ASC`,
    [Number(runId), ...scoped.params]
  );

  return {
    run,
    items: itemRows.map((row) => sanitizeEvaluationRunItemRow(row)),
  };
};

const buildEvaluationFactBundle = async ({ bid }) => {
  const latestParseJob = await loadLatestParseJobRow(Number(bid.id));
  const parseDetail = latestParseJob ? await loadParseJobDetail(latestParseJob.id, { bidId: Number(bid.id) }) : null;
  const currentVersion = await getCurrentVersion(bid);
  const sectionRows = currentVersion
    ? await loadDraftSectionRegistryRows({ bidId: Number(bid.id), versionId: Number(currentVersion.id) })
    : [];
  const artifactRows = currentVersion
    ? (await loadDraftArtifactRows({ bidId: Number(bid.id), versionId: Number(currentVersion.id) })).map((row) => sanitizeDraftArtifactRow(row))
    : [];
  const scoreCoverageRows = currentVersion
    ? (await loadScoreCoverageRows({ bidId: Number(bid.id), versionId: Number(currentVersion.id) })).map((row) => sanitizeScoreCoverageRow(row))
    : [];
  const latestCheck = await loadLatestDraftCheckRun({ bidId: Number(bid.id) });
  const exportRecords = await loadExportRecordsByBidIds({ bidIds: [Number(bid.id)], limit: 10 });
  return {
    bid,
    parseDetail: parseDetail || { job: null, clauses: [], tables: [], matches: [] },
    currentVersion,
    sectionRows: Array.isArray(sectionRows) ? sectionRows : [],
    artifactRows,
    scoreCoverageRows,
    latestCheck,
    latestExportRecord: exportRecords[0] || null,
  };
};

const buildScoreCoveragePayloadFromFacts = (facts = {}) => {
  const derivedScoreItems = buildKbScoreItemRows({
    kbProjectId: Number(facts?.bid?.id || 0) || 0,
    clauses: facts?.parseDetail?.clauses || [],
  });
  const rowTitles = (Array.isArray(facts?.scoreCoverageRows) ? facts.scoreCoverageRows : [])
    .map((item) => trimText(item?.title))
    .filter(Boolean);
  return {
    score_item_names: uniqueTextList([...rowTitles, ...derivedScoreItems.map((item) => trimText(item?.item_name))]),
    recommended_points: uniqueTextList(
      derivedScoreItems.flatMap((item) => Array.isArray(item?.recommended_response_points) ? item.recommended_response_points : [])
    ),
  };
};

const buildMaterialMatchingPayloadFromFacts = (facts = {}) => {
  const matches = Array.isArray(facts?.parseDetail?.matches) ? facts.parseDetail.matches : [];
  return {
    matched_asset_ids: uniqueTextList(matches.map((item) => {
      const assetId = Number(item?.asset_id || 0);
      return assetId > 0 ? `A-${assetId}` : '';
    })),
    need_manual_review_count: matches.filter((item) => {
      const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
      return !!payload.need_manual_review;
    }).length,
    total_match_count: matches.length,
  };
};

const buildRiskRecallPayloadFromFacts = (facts = {}) => {
  const issues = Array.isArray(facts?.latestCheck?.issues) ? facts.latestCheck.issues : [];
  return {
    risk_codes: uniqueTextList(issues.map((item) => trimText(item?.issue_type))),
    high_risk_codes: uniqueTextList(
      issues
        .filter((item) => ['FATAL', 'HIGH', 'ERROR'].includes(trimText(item?.severity).toUpperCase()))
        .map((item) => trimText(item?.issue_type))
    ),
  };
};

const buildExportCompletenessPayloadFromFacts = (facts = {}) => {
  const sectionDeliverables = (Array.isArray(facts?.sectionRows) ? facts.sectionRows : [])
    .map((item) => trimText(item?.section_title))
    .filter(Boolean);
  const artifactDeliverables = (Array.isArray(facts?.artifactRows) ? facts.artifactRows : [])
    .map((item) => {
      const group = trimText(item?.artifact_group);
      const type = trimText(item?.artifact_type);
      if (!group && !type) return '';
      return [group, type].filter(Boolean).join('_');
    })
    .filter(Boolean);
  return {
    deliverables: uniqueTextList([...sectionDeliverables, ...artifactDeliverables]),
    latest_export_status: trimText(facts?.latestExportRecord?.status).toUpperCase(),
  };
};

const buildEvaluationActualPayload = ({ evalType, facts }) => {
  const clauses = Array.isArray(facts?.parseDetail?.clauses) ? facts.parseDetail.clauses : [];
  if (evalType === 'CLAUSE_RECOGNITION') {
    return {
      clause_count: clauses.length,
      mandatory_count: clauses.filter((item) => Number(item?.mandatory_flag || 0) > 0).length,
      scoring_count: clauses.filter((item) => Number(item?.scoring_flag || 0) > 0).length,
      clause_types: uniqueTextList(clauses.map((item) => trimText(item?.clause_type))),
    };
  }
  if (evalType === 'SCORE_COVERAGE') return buildScoreCoveragePayloadFromFacts(facts);
  if (evalType === 'MATERIAL_MATCHING') return buildMaterialMatchingPayloadFromFacts(facts);
  if (evalType === 'RISK_RECALL') return buildRiskRecallPayloadFromFacts(facts);
  if (evalType === 'EXPORT_COMPLETENESS') return buildExportCompletenessPayloadFromFacts(facts);
  return {};
};

const buildEvaluationExpectedPayloadFromFacts = ({ evalType, facts }) => {
  if (evalType === 'MATERIAL_MATCHING') {
    const current = buildMaterialMatchingPayloadFromFacts(facts);
    return normalizeEvaluationExpectedPayload(evalType, {
      required_asset_ids: current.matched_asset_ids,
    });
  }
  if (evalType === 'EXPORT_COMPLETENESS') {
    const current = buildExportCompletenessPayloadFromFacts(facts);
    return normalizeEvaluationExpectedPayload(evalType, {
      required_deliverables: current.deliverables,
    });
  }
  return normalizeEvaluationExpectedPayload(evalType, buildEvaluationActualPayload({ evalType, facts }));
};

const determineEvaluationRunStatus = (summary = {}) => {
  if (Number(summary?.fail_count || 0) > 0) return 'FAILED';
  if (Number(summary?.warning_count || 0) > 0) return 'WARNING';
  return 'SUCCESS';
};

const loadLatestBaselineRun = async () => sanitizeEvaluationRunRow(await get(
  `SELECT *
   FROM tender_eval_runs
   WHERE run_scope = 'BASELINE'
   ORDER BY id DESC
   LIMIT 1`
));

const evaluationTypeToSummaryKey = (evalType) => {
  const normalized = normalizeEvaluationType(evalType);
  if (normalized === 'CLAUSE_RECOGNITION') return 'clause_recognition';
  if (normalized === 'SCORE_COVERAGE') return 'score_coverage';
  if (normalized === 'MATERIAL_MATCHING') return 'material_matching';
  if (normalized === 'RISK_RECALL') return 'risk_recall';
  if (normalized === 'EXPORT_COMPLETENESS') return 'export_completeness';
  return '';
};

const ensureParseFileExists = async ({ bidId, fileId }) => {
  const row = await get(
    `SELECT *
     FROM tender_bid_parse_files
     WHERE id = ? AND bid_id = ?
     LIMIT 1`,
    [Number(fileId), Number(bidId)]
  );
  const file = sanitizeParseFileRow(row);
  if (!file || file.status === 'DELETED') {
    throw tenderStageError({
      message: '解析文件不存在',
      statusCode: 404,
      code: 'TENDER_PARSE_FILE_NOT_FOUND',
      category: 'BUSINESS',
      manualTakeover: buildManualTakeover('请刷新页面后确认文件仍存在', 'parse_file'),
    });
  }
  return file;
};

const ensureParseJobExists = async ({ bidId, jobId }) => {
  const detail = await loadParseJobDetail(jobId, { bidId });
  if (!detail) {
    throw tenderStageError({
      message: '解析任务不存在',
      statusCode: 404,
      code: 'TENDER_PARSE_JOB_NOT_FOUND',
      category: 'BUSINESS',
      manualTakeover: buildManualTakeover('请刷新页面后重试', 'parse_job'),
    });
  }
  return detail;
};

const refreshBidStatusAfterParseUpload = async ({ bidId, user }) => {
  const bid = await get('SELECT id, status FROM tender_bids WHERE id = ? LIMIT 1', [Number(bidId)]);
  const currentStatus = normalizeStatus(bid?.status);
  if (currentStatus !== 'DRAFT') return;
  await run(
    `UPDATE tender_bids
     SET status = 'FILES_UPLOADED', updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [Number(user?.id || 0) || null, trimText(user?.username) || null, Number(bidId)]
  );
};

const refreshBidStatusAfterParseCompleted = async ({ bidId, user }) => {
  const bid = await get('SELECT id, status FROM tender_bids WHERE id = ? LIMIT 1', [Number(bidId)]);
  const currentStatus = normalizeStatus(bid?.status);
  if (!currentStatus) return;
  const allowed = statusTransitions[currentStatus] || new Set();
  if (currentStatus === 'PARSE_COMPLETED' || !allowed.has('PARSE_COMPLETED')) return;
  await run(
    `UPDATE tender_bids
     SET status = 'PARSE_COMPLETED', updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [Number(user?.id || 0) || null, trimText(user?.username) || null, Number(bidId)]
  );
};

const collectParseSourcePayload = async (file) => {
  const sourceExt = trimText(file?.source_ext).toLowerCase();
  const sourcePath = trimText(file?.storage_path);
  const displayName = trimText(file?.display_name || file?.original_file_name);
  if (!sourcePath) {
    return {
      text: '',
      tables: [],
      fields: {},
      workbook: null,
      parse_summary: {},
    };
  }

  if (['.xlsx', '.xls'].includes(sourceExt)) {
    const workbook = await loadSpreadsheetWorkbookFromStoredFile({
      sourcePath,
      sourceExt,
      sourceName: displayName,
      selectedSheetNames: file?.selected_sheet_names || [],
    });
    const tables = buildSpreadsheetTables(workbook);
    const text = trimText(workbook.text);
    return {
      text,
      tables,
      fields: extractProjectFieldsFromText(text),
      workbook,
      parse_summary: buildParseFilePreviewSummary(workbook),
    };
  }

  const text = await textByExtFromStorage({
    sourcePath,
    sourceExt,
    maxLen: BID_ANALYZE_MAX_TEXT,
  });
  const tables = await tablesByExtFromStorage({
    sourcePath,
    sourceExt,
    sourceText: text,
  });
  return {
    text,
    tables,
    fields: extractProjectFieldsFromText(text),
    workbook: null,
    parse_summary: {
      text_length: text.length,
      table_count: tables.length,
    },
  };
};

const loadParseRecommendationChunks = async (bidId) => {
  const [
    assetRows,
    kbChunkRows,
    kbSectionRows,
    kbCaseRows,
    kbSpecRows,
    kbQualificationRows,
    kbPersonnelRows,
  ] = await Promise.all([
    query(
      `SELECT a.*, GROUP_CONCAT(o.ocr_text SEPARATOR ' ') AS ocr_text
       FROM tender_assets a
       LEFT JOIN tender_asset_ocr_results o ON o.asset_id = a.id
       WHERE a.bid_id = ?
       GROUP BY a.id
       ORDER BY a.id DESC`,
      [Number(bidId)]
    ),
    query(
      `SELECT *
       FROM kb_asset_chunks
       WHERE reusable_flag = 1
       ORDER BY updated_at DESC, id DESC
       LIMIT 120`
    ),
    query(
      `SELECT *
       FROM kb_section_assets
       WHERE reusable_flag = 1 AND status = 'ACTIVE'
       ORDER BY updated_at DESC, id DESC
       LIMIT 80`
    ),
    query(
      `SELECT *
       FROM kb_project_cases
       WHERE reusable_flag = 1
       ORDER BY updated_at DESC, id DESC
       LIMIT 80`
    ),
    query(
      `SELECT *
       FROM kb_product_specs
       WHERE status = 'ACTIVE'
       ORDER BY updated_at DESC, id DESC
       LIMIT 80`
    ),
    query(
      `SELECT *
       FROM kb_company_qualifications
       WHERE status = 'ACTIVE'
       ORDER BY updated_at DESC, id DESC
       LIMIT 80`
    ),
    query(
      `SELECT *
       FROM kb_personnel_assets
       WHERE status = 'ACTIVE'
       ORDER BY updated_at DESC, id DESC
       LIMIT 80`
    ),
  ]);

  return buildSemanticRetrievalChunks({
    projectAssets: assetRows,
    kbChunks: kbChunkRows,
    kbSectionAssets: kbSectionRows,
    kbProjectCases: kbCaseRows,
    kbProductSpecs: kbSpecRows,
    kbQualifications: kbQualificationRows,
    kbPersonnelAssets: kbPersonnelRows,
  });
};

const loadParseRecommendationFeedbackIndex = async () => {
  const rows = await query(
    `SELECT asset_id, match_status, payload_json, updated_at, created_at
     FROM tender_bid_parse_matches
     WHERE match_status IN ('CONFIRMED', 'REPLACED', 'IGNORED')
     ORDER BY updated_at DESC, id DESC
     LIMIT 4000`
  );
  return buildSemanticFeedbackIndex(rows.map((row) => ({
    asset_id: Number(row.asset_id || 0) || null,
    match_status: trimText(row.match_status).toUpperCase(),
    payload: parseMaybeJson(row.payload_json, {}),
    updated_at: row.updated_at,
    created_at: row.created_at,
  })));
};

const buildParseMatchPayloadWithFeedback = ({ basePayload, nextPayload, matchStatus, user }) => {
  const merged = {
    ...(basePayload && typeof basePayload === 'object' && !Array.isArray(basePayload) ? basePayload : {}),
    ...(nextPayload && typeof nextPayload === 'object' && !Array.isArray(nextPayload) ? nextPayload : {}),
  };

  delete merged.feedback_status;
  delete merged.feedback_updated_at;
  delete merged.feedback_actor;

  if (PARSE_MATCH_FEEDBACK_STATUS.has(matchStatus)) {
    merged.feedback_status = matchStatus;
    merged.feedback_updated_at = new Date().toISOString();
    merged.feedback_actor = {
      id: Number(user?.id || 0) || null,
      username: trimText(user?.username) || null,
    };
  }

  return merged;
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
  if (draft) return sanitizeDraftRow(draft);

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
  return sanitizeDraftRow(draft);
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

const buildOnlyOfficeGenerateSourcePreviewConfig = ({ job, sourceUrl, user }) => {
  const sourceName = trimText(job?.source_file_name) || '招标文件.docx';
  const title = sourceName.toLowerCase().endsWith('.docx')
    ? sourceName
    : `${path.parse(sourceName).name || '招标文件'}.docx`;
  const fileSize = Number(job?.source_file_size || 0);
  const updatedTag = String(job?.updated_at || job?.created_at || '')
    .replace(/[^0-9]/g, '')
    .slice(0, 14) || `${Date.now()}`;
  const safeKey = `generate_source_${Number(job?.id || 0)}_${fileSize}_${updatedTag}`
    .replace(/[^0-9A-Za-z._=-]/g, '_')
    .slice(0, 128);

  const config = {
    document: {
      fileType: 'docx',
      key: safeKey,
      title,
      url: sourceUrl,
      permissions: {
        edit: false,
        download: true,
        print: true,
        copy: true,
      },
    },
    documentType: 'word',
    editorConfig: {
      mode: 'view',
      lang: 'zh-CN',
      user: {
        id: String(Number(user?.id || 0) || 0),
        name: String(user?.username || '预览用户'),
      },
      customization: {
        autosave: false,
        forcesave: false,
        compactToolbar: true,
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
      return cb(uploadValidationError('仅支持上传 doc/docx/pdf', {
        code: 'TENDER_UPLOAD_INVALID_FILE',
        manualTakeover: buildManualTakeover('请重新选择 doc/docx/pdf 文件后上传', 'upload'),
      }));
    }
    return cb(null, true);
  },
});

const uploadBidVersion = (req, res, next) => {
  bidVersionUpload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadFileName(req);
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(uploadValidationError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, {
        code: 'TENDER_UPLOAD_FILE_TOO_LARGE',
        manualTakeover: buildManualTakeover('请压缩文件或拆分后重新上传', 'upload'),
      }));
    }
    return next(uploadValidationError(err.message || '文件上传失败'));
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
      return cb(uploadValidationError('仅支持上传 doc/docx/pdf', {
        code: 'TENDER_UPLOAD_INVALID_FILE',
        manualTakeover: buildManualTakeover('请重新选择 doc/docx/pdf 文件后上传', 'upload'),
      }));
    }
    return cb(null, true);
  },
});

const uploadTenderSourceFile = (req, res, next) => {
  tenderSourceUpload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadFileName(req);
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(uploadValidationError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, {
        code: 'TENDER_UPLOAD_FILE_TOO_LARGE',
        manualTakeover: buildManualTakeover('请压缩文件或拆分后重新上传', 'upload'),
      }));
    }
    return next(uploadValidationError(err.message || '文件上传失败'));
  });
};

const tenderParseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PARSE_ROOT),
    filename: (_req, file, cb) => {
      const ext = normalizeParseUploadExt(file.originalname || '') || '.docx';
      cb(null, buildStoredFilename(file.originalname, ext));
    },
  }),
  limits: {
    fileSize: FILE_MAX_BYTES,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    const ext = normalizeParseUploadExt(file.originalname || '');
    const mime = trimText(file.mimetype).toLowerCase();
    if (!ext || (!ALLOWED_PARSE_UPLOAD_MIME.has(mime) && mime)) {
      return cb(uploadValidationError('仅支持上传 doc/docx/pdf/xls/xlsx/zip', {
        code: 'TENDER_PARSE_UPLOAD_INVALID_FILE',
        manualTakeover: buildManualTakeover('请重新选择 doc/docx/pdf/xls/xlsx/zip 文件后上传', 'upload'),
      }));
    }
    return cb(null, true);
  },
});

const uploadTenderParseFiles = (req, res, next) => {
  tenderParseUpload.array('files', 20)(req, res, (err) => {
    if (!err) {
      if (Array.isArray(req.files)) {
        req.files.forEach((item) => {
          item.originalname = fixMojibakeText(item.originalname);
        });
      }
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(uploadValidationError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, {
        code: 'TENDER_UPLOAD_FILE_TOO_LARGE',
        manualTakeover: buildManualTakeover('请压缩文件或拆分后重新上传', 'upload'),
      }));
    }
    return next(uploadValidationError(err.message || '文件上传失败'));
  });
};

const sampleUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SAMPLE_ROOT),
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
      return cb(uploadValidationError('仅支持上传 doc/docx/pdf', {
        code: 'TENDER_UPLOAD_INVALID_FILE',
        manualTakeover: buildManualTakeover('请重新选择 doc/docx/pdf 文件后上传', 'upload'),
      }));
    }
    return cb(null, true);
  },
});

const uploadSampleFile = (req, res, next) => {
  sampleUpload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadFileName(req);
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(uploadValidationError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, {
        code: 'TENDER_UPLOAD_FILE_TOO_LARGE',
        manualTakeover: buildManualTakeover('请压缩文件或拆分后重新上传', 'upload'),
      }));
    }
    return next(uploadValidationError(err.message || '文件上传失败'));
  });
};

const docTemplateUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMPLATE_ROOT),
    filename: (_req, file, cb) => {
      const ext = normalizeDocTemplateExt(file.originalname || '') || '.docx';
      cb(null, buildStoredFilename(file.originalname, ext));
    },
  }),
  limits: {
    fileSize: FILE_MAX_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = normalizeDocTemplateExt(file.originalname || '');
    const mime = trimText(file.mimetype).toLowerCase();
    if (!ext || (!ALLOWED_DOC_TEMPLATE_MIME.has(mime) && mime)) {
      return cb(uploadValidationError('仅支持上传 docx 模板', {
        code: 'TENDER_UPLOAD_INVALID_TEMPLATE',
        manualTakeover: buildManualTakeover('请上传 docx 模板文件', 'template'),
      }));
    }
    return cb(null, true);
  },
});

const uploadDocTemplateFile = (req, res, next) => {
  docTemplateUpload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadFileName(req);
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(uploadValidationError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, {
        code: 'TENDER_UPLOAD_FILE_TOO_LARGE',
        manualTakeover: buildManualTakeover('请压缩模板文件后重新上传', 'template'),
      }));
    }
    return next(uploadValidationError(err.message || '文件上传失败'));
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
      return cb(uploadValidationError('仅支持上传 jpg/png/pdf', {
        code: 'TENDER_UPLOAD_INVALID_ASSET',
        manualTakeover: buildManualTakeover('请上传 jpg/png/pdf 资产文件', 'asset'),
      }));
    }
    return cb(null, true);
  },
});

const uploadAssetFile = (req, res, next) => {
  assetUpload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadFileName(req);
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(uploadValidationError(`文件大小不能超过 ${Math.floor(FILE_MAX_BYTES / 1024 / 1024)}MB`, {
        code: 'TENDER_UPLOAD_FILE_TOO_LARGE',
        manualTakeover: buildManualTakeover('请压缩资产文件后重新上传', 'asset'),
      }));
    }
    return next(uploadValidationError(err.message || '文件上传失败'));
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
  const safeOriginalName = fixMojibakeText(asset.original_file_name);
  const targetPath = path.join(WATERMARK_ROOT, buildStoredFilename(safeOriginalName, ext));

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
    filename: safeOriginalName || path.basename(targetPath),
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
  let resp;
  try {
    resp = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      runtime.timeout_ms
    );
  } catch (err) {
    throw tenderStageError({
      message: `模型调用失败: ${trimText(err?.message) || '请求超时'}`,
      statusCode: 502,
      code: 'TENDER_AI_UPSTREAM_TIMEOUT',
      category: 'AI',
      retryable: true,
      manualTakeover: buildManualTakeover('请稍后重试或切换备用模型', 'ai_model'),
      details: {
        endpoint,
        timeout_ms: Number(runtime.timeout_ms || 0),
      },
    });
  }
  const raw = await resp.text();
  const latencyMs = Date.now() - startedAt;

  if (!resp.ok) {
    const retryable = resp.status === 429 || resp.status >= 500;
    throw tenderStageError({
      message: `模型调用失败: HTTP ${resp.status} ${raw.slice(0, 200)}`,
      statusCode: retryable ? 502 : 400,
      code: resp.status === 429 ? 'TENDER_AI_UPSTREAM_RATE_LIMIT' : retryable ? 'TENDER_AI_UPSTREAM_FAILED' : 'TENDER_AI_REQUEST_REJECTED',
      category: 'AI',
      retryable,
      manualTakeover: buildManualTakeover(
        retryable ? '请稍后重试或切换备用模型' : '请检查提示词、模型配置或输入内容后重试',
        'ai_model'
      ),
      details: {
        upstream_status: Number(resp.status || 0),
      },
    });
  }

  const parsed = parseMaybeJson(raw, null);
  if (!parsed) throw tenderStageError({
    message: '模型返回非JSON',
    statusCode: 502,
    code: 'TENDER_AI_RESPONSE_INVALID_JSON',
    category: 'AI',
    retryable: false,
    manualTakeover: buildManualTakeover('请切换模型或调整任务提示词后重试', 'ai_model'),
  });
  const content = parsed?.choices?.[0]?.message?.content;
  if (!trimText(content)) throw tenderStageError({
    message: '模型返回内容为空',
    statusCode: 502,
    code: 'TENDER_AI_RESPONSE_EMPTY',
    category: 'AI',
    retryable: false,
    manualTakeover: buildManualTakeover('请切换模型或调整任务提示词后重试', 'ai_model'),
  });

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

const parseHeadersObject = (input, fallback = {}) => {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const parsed = parseMaybeJson(input, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
};

const ensureIntMin = (value, fallback, min) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.round(n));
};

const ensureFloatWithFallback = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const buildModelRuntimeForTest = async (body = {}) => {
  const modelId = Number(body.model_id || 0);
  const hasModelId = Number.isFinite(modelId) && modelId > 0;

  let baseModel = null;
  let baseRuntime = null;
  if (hasModelId) {
    baseModel = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [modelId]);
    if (!baseModel) throw appError('模型不存在', 404);
    baseRuntime = resolveModelRuntime(baseModel);
  }

  const name = trimText(body.name) || trimText(baseModel?.name) || '临时模型';
  const model_key = trimText(body.model_key).toLowerCase() || trimText(baseModel?.model_key).toLowerCase() || 'temporary_model_test';
  const model_name = trimText(body.model_name) || trimText(baseModel?.model_name) || trimText(baseRuntime?.model_name);
  const base_url = trimText(body.base_url) || trimText(baseModel?.base_url) || trimText(baseRuntime?.base_url);

  let api_key = trimText(baseRuntime?.api_key);
  if (body.api_key !== undefined) {
    const incomingApiKey = trimText(body.api_key);
    if (incomingApiKey && incomingApiKey !== SECRET_MASK) {
      api_key = incomingApiKey;
    }
  }

  const mergedHeaders = parseHeadersObject(body.extra_headers_json, parseMaybeJson(baseModel?.extra_headers_json, {}));
  const timeout_ms = ensureIntMin(body.timeout_ms, Number(baseRuntime?.timeout_ms || baseModel?.timeout_ms || 20000), 3000);
  const max_tokens = ensureIntMin(body.max_tokens, Number(baseRuntime?.max_tokens || baseModel?.max_tokens || 4096), 256);
  const temperature_default = ensureFloatWithFallback(
    body.temperature_default,
    Number(baseRuntime?.temperature_default || baseModel?.temperature_default || 0.3)
  );

  if (!base_url || !api_key || !model_name) {
    throw appError('模型配置不完整（base_url/api_key/model_name）', 400);
  }

  return {
    source: hasModelId ? 'saved_or_editing' : 'draft',
    modelMeta: {
      id: hasModelId ? modelId : 0,
      name,
      model_key,
      model_name,
      base_url,
    },
    runtime: {
      base_url,
      api_key,
      model_name,
      timeout_ms,
      max_tokens,
      temperature_default,
      extra_headers: mergedHeaders,
    },
  };
};

const runAiModelConnectionTest = async ({ req, modelMeta, runtime, source }) => {
  const taskType = 'AI_MODEL_TEST';
  const requestPayload = {
    task_type: taskType,
    source,
    model: {
      id: Number(modelMeta?.id || 0),
      model_key: trimText(modelMeta?.model_key),
      model_name: trimText(modelMeta?.model_name || runtime?.model_name),
      base_url: trimText(modelMeta?.base_url || runtime?.base_url),
    },
  };
  const requestHash = sha256Hex(stableStringify(requestPayload));

  try {
    const result = await callOpenAiCompatible({
      runtime,
      messages: [
        { role: 'system', content: '你是模型连通性测试助手，请只回复“连接成功”。' },
        { role: 'user', content: '请返回“连接成功”，用于验证模型配置是否可用。' },
      ],
      temperature: 0,
      maxTokens: 64,
    });

    const responseHash = sha256Hex(result.raw || result.content);

    const insert = await run(
      `INSERT INTO tender_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, request_hash, response_hash, error_message, operator_id, operator_name, request_ip)
       VALUES (?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        taskType,
        Number(modelMeta?.id || 0),
        trimText(modelMeta?.name || runtime?.model_name || '模型测试'),
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

    await logOperation({
      req,
      action: 'AI_MODEL_TEST',
      entity: 'ai_model',
      entityId: Number(modelMeta?.id || 0) || null,
      message: `测试模型连接 ${trimText(modelMeta?.model_key || modelMeta?.name || runtime?.model_name)}`,
      afterData: {
        source,
        task_log_id: insert.insertId,
        model_id: Number(modelMeta?.id || 0),
        model_key: trimText(modelMeta?.model_key),
        model_name: trimText(modelMeta?.model_name || runtime?.model_name),
        base_url: trimText(modelMeta?.base_url || runtime?.base_url),
        latency_ms: Number(result.latencyMs || 0),
      },
    });

    return {
      ok: true,
      source,
      task_log_id: insert.insertId,
      model: {
        id: Number(modelMeta?.id || 0),
        name: trimText(modelMeta?.name || runtime?.model_name),
        model_key: trimText(modelMeta?.model_key),
        model_name: trimText(modelMeta?.model_name || runtime?.model_name),
        base_url: trimText(modelMeta?.base_url || runtime?.base_url),
      },
      latency_ms: Number(result.latencyMs || 0),
      usage: {
        prompt_tokens: Number(result.usage?.prompt_tokens || 0),
        completion_tokens: Number(result.usage?.completion_tokens || 0),
        total_tokens: Number(result.usage?.total_tokens || 0),
      },
      content_preview: String(result.content || '').slice(0, 200),
    };
  } catch (err) {
    const insert = await run(
      `INSERT INTO tender_ai_task_logs
        (task_type, model_id, model_name, status, latency_ms, request_hash, response_hash, error_message, operator_id, operator_name, request_ip)
       VALUES (?, ?, ?, 'FAILED', ?, ?, NULL, ?, ?, ?, ?)`,
      [
        taskType,
        Number(modelMeta?.id || 0),
        trimText(modelMeta?.name || runtime?.model_name || '模型测试'),
        0,
        requestHash,
        trimText(err.message).slice(0, 2000),
        Number(req.user.id),
        trimText(req.user.username),
        trimText(getClientIp(req)),
      ]
    );

    await logOperation({
      req,
      action: 'AI_MODEL_TEST_FAIL',
      entity: 'ai_model',
      entityId: Number(modelMeta?.id || 0) || null,
      message: `模型连接测试失败 ${trimText(modelMeta?.model_key || modelMeta?.name || runtime?.model_name)}`,
      afterData: {
        source,
        task_log_id: insert.insertId,
        model_id: Number(modelMeta?.id || 0),
        model_key: trimText(modelMeta?.model_key),
        model_name: trimText(modelMeta?.model_name || runtime?.model_name),
        base_url: trimText(modelMeta?.base_url || runtime?.base_url),
        error: trimText(err.message).slice(0, 2000),
      },
    });

    throw err;
  }
};

const resolveDocTemplate = async (templateId) => {
  let row = null;
  if (Number.isFinite(Number(templateId)) && Number(templateId) > 0) {
    row = await get(
      'SELECT * FROM tender_doc_templates WHERE id = ? AND status = \'ACTIVE\' LIMIT 1',
      [Number(templateId)]
    );
    if (!row) throw appError('所选投标模板不存在或已停用', 400);
    return sanitizeDocTemplateRow(row);
  }

  row = await get('SELECT * FROM tender_doc_templates WHERE status = \'ACTIVE\' AND is_default = 1 LIMIT 1');
  if (row) return sanitizeDocTemplateRow(row);
  row = await get('SELECT * FROM tender_doc_templates WHERE status = \'ACTIVE\' ORDER BY id ASC LIMIT 1');
  return sanitizeDocTemplateRow(row);
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
  const taskRuntime = { ...runtime };
  if (ANALYZE_STAGE_TASK_TYPE_SET.has(trimText(taskType))) {
    taskRuntime.timeout_ms = Math.max(Number(taskRuntime.timeout_ms || 0), AI_ANALYZE_TASK_TIMEOUT_MS);
  }
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
      runtime: taskRuntime,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inputText },
      ],
      temperature: taskRuntime.temperature_default,
      maxTokens: taskRuntime.max_tokens,
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

const loadSampleSections = async (sampleId) => {
  const rows = await query(
    `SELECT sample_id, section_key, section_title, section_text, summary_text, keywords_json
     FROM tender_bid_sample_sections
     WHERE sample_id = ?
     ORDER BY id ASC`,
    [Number(sampleId)]
  );
  return rows.map((item) => ({
    ...item,
    keywords: parseMaybeJson(item.keywords_json, []),
  }));
};

const loadSampleFeatures = async (sampleId) => {
  const rows = await query(
    `SELECT feature_key, feature_value, feature_weight
     FROM tender_bid_sample_features
     WHERE sample_id = ?
     ORDER BY id ASC`,
    [Number(sampleId)]
  );
  const features = {
    keywords: [],
  };
  for (const row of rows) {
    const key = trimText(row.feature_key);
    if (key === 'keyword') {
      if (trimText(row.feature_value)) features.keywords.push(trimText(row.feature_value));
      continue;
    }
    features[key] = trimText(row.feature_value);
  }
  return features;
};

const loadGenerateJobDetail = async (jobId) => {
  const job = await get('SELECT * FROM tender_bid_generate_jobs WHERE id = ? LIMIT 1', [Number(jobId)]);
  if (!job) return null;
  const items = await query(
    `SELECT *
     FROM tender_bid_generate_items
     WHERE job_id = ?
     ORDER BY item_type ASC, sort_order ASC, id ASC`,
    [Number(jobId)]
  );
  const matches = await query(
    `SELECT m.*, s.sample_no, s.title, s.original_file_name
     FROM tender_bid_generate_matches m
     LEFT JOIN tender_bid_samples s ON s.id = m.sample_id
     WHERE m.job_id = ?
     ORDER BY m.rank_no ASC, m.id ASC`,
    [Number(jobId)]
  );

  return {
    job: sanitizeGenerateJobRow(job),
    items: items.map((row) => ({
      ...row,
      title: fixMojibakeText(row.title),
      evidence_text: fixMojibakeText(row.evidence_text),
      suggestion_text: fixMojibakeText(row.suggestion_text),
      section_title: fixMojibakeText(row.section_title),
    })),
    matches: matches.map((row) => ({
      ...row,
      sample_no: fixMojibakeText(row.sample_no),
      title: fixMojibakeText(row.title),
      original_file_name: fixMojibakeText(row.original_file_name),
      reason_text: fixMojibakeText(row.reason_text),
    })),
  };
};

const toNumberIdList = (value, maxLen = 20) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const id = Number(item);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
    if (ids.length >= maxLen) break;
  }
  return ids;
};

const normalizeInstructionForm = (value = {}) => {
  const source = isPlainObject(value) ? value : {};
  const normalizeLine = (input, max = 200) => trimText(input).replace(/\s+/g, ' ').slice(0, max);
  const normalizeText = (input, max = 2400) => trimText(input).slice(0, max);

  return {
    project_name: normalizeLine(source.project_name, 300),
    project_code: normalizeLine(source.project_code, 120),
    package_no: normalizeLine(source.package_no, 120),
    budget: normalizeLine(source.budget, 120),
    buyer_name: normalizeLine(source.buyer_name, 300),
    agency_name: normalizeLine(source.agency_name, 300),
    project_domain: normalizeLine(source.project_domain, 200),
    project_overview: normalizeText(source.project_overview, 4000),
  };
};

const applyInstructionFormToFinalJson = (sourceFinalJson = {}, instructionForm = {}, bidCategory = 'SERVICE') => {
  const normalized = normalizeFinalAnalyzeJson(sourceFinalJson, bidCategory);
  const form = normalizeInstructionForm(instructionForm);
  if (!isPlainObject(normalized.project_core_info)) normalized.project_core_info = {};
  const core = normalized.project_core_info;

  if (trimText(form.project_name)) core.project_full_name = form.project_name;
  if (trimText(form.project_code)) core.project_code = form.project_code;
  if (trimText(form.package_no)) core.package_no = form.package_no;
  if (trimText(form.budget)) core.project_budget = form.budget;
  if (trimText(form.buyer_name)) core.buyer_full_name = form.buyer_name;
  if (trimText(form.agency_name)) core.agency_full_name = form.agency_name;
  if (trimText(form.project_domain)) {
    core.project_domain = form.project_domain;
    if ((normalizeBidCategory(bidCategory) || 'SERVICE') === 'PRODUCT') core.goods_category = form.project_domain;
    else core.service_category = form.project_domain;
  }
  if (trimText(form.project_overview)) core.project_overview = form.project_overview;

  return { finalJson: normalized, instructionForm: form };
};

const collectOwnLibrarySnapshot = async (inputSnapshot = {}) => {
  const fromInput = inputSnapshot && typeof inputSnapshot === 'object' ? inputSnapshot : {};
  const company = fromInput.company && typeof fromInput.company === 'object' ? fromInput.company : {};
  const personnel = fromInput.personnel && typeof fromInput.personnel === 'object' ? fromInput.personnel : {};

  const qualifications = Array.isArray(fromInput.qualifications)
    ? fromInput.qualifications
    : (
      await query(
        `SELECT r.fields_json
         FROM tender_assets a
         LEFT JOIN tender_asset_ocr_results r ON r.asset_id = a.id
         WHERE a.asset_type = 'QUALIFICATION'
         ORDER BY a.id DESC
         LIMIT 50`
      )
    ).map((item) => (item?.fields_json && typeof item.fields_json === 'string' ? parseMaybeJson(item.fields_json, {}) : item));

  const finance = Array.isArray(fromInput.finance)
    ? fromInput.finance
    : (
      await query(
        `SELECT r.fields_json
         FROM tender_assets a
         LEFT JOIN tender_asset_ocr_results r ON r.asset_id = a.id
         WHERE (r.doc_type = 'FINANCE_INFO' OR JSON_UNQUOTE(JSON_EXTRACT(r.fields_json, '$.library_section')) = 'finance')
         ORDER BY a.id DESC
         LIMIT 50`
      )
    ).map((item) => (item?.fields_json && typeof item.fields_json === 'string' ? parseMaybeJson(item.fields_json, {}) : item));

  return {
    company,
    personnel,
    qualifications: qualifications.filter(Boolean),
    finance: finance.filter(Boolean),
    performance: Array.isArray(fromInput.performance) ? fromInput.performance.filter(Boolean) : [],
    personnel_list: Array.isArray(fromInput.personnel_list) ? fromInput.personnel_list.filter(Boolean) : [],
  };
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: APP_NAME });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: APP_NAME });
});

app.get('/api/ready', async (_req, res) => {
  try {
    await get('SELECT 1 AS ok');
    res.json({ status: 'ok', service: APP_NAME, database: 'ok' });
  } catch (_err) {
    res.status(503).json({ status: 'degraded', service: APP_NAME, database: 'error' });
  }
});

app.get('/api/version', (_req, res) => {
  res.json({ service: APP_NAME, version: APP_VERSION });
});

app.get('/api/build', (_req, res) => {
  res.json({
    service: APP_NAME,
    version: APP_VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME,
  });
});

app.get('/api/metrics', (_req, res) => {
  res.json(buildMetricsSnapshot());
});

app.get('/api/tender/bootstrap', asyncHandler(async (req, res) => {
  const bidCount = await get('SELECT COUNT(1) AS count FROM tender_bids');
  const activeDrafts = await get('SELECT COUNT(1) AS count FROM tender_bid_drafts');
  const assetCount = await get('SELECT COUNT(1) AS count FROM tender_assets');
  const modelCount = await get('SELECT COUNT(1) AS count FROM tender_ai_models WHERE is_enabled = 1');
  const kbProjectCount = await get('SELECT COUNT(1) AS count FROM kb_projects');
  const kbChunkCount = await get('SELECT COUNT(1) AS count FROM kb_asset_chunks');
  const bidStatusRows = await query('SELECT status, COUNT(1) AS count FROM tender_bids GROUP BY status');
  const reviewStatusRows = await query('SELECT review_status, COUNT(1) AS count FROM tender_bids GROUP BY review_status');

  const statusCountMap = Object.fromEntries(
    (Array.isArray(bidStatusRows) ? bidStatusRows : []).map((row) => [normalizeStatus(row.status), Number(row.count || 0)])
  );
  const reviewCountMap = Object.fromEntries(
    (Array.isArray(reviewStatusRows) ? reviewStatusRows : []).map((row) => [normalizeReviewStatus(row.review_status), Number(row.count || 0)])
  );

  const todo = {
    pending_parse: Number(statusCountMap.FILES_UPLOADED || 0),
    pending_materials: Number(statusCountMap.MATERIALS_PENDING || 0),
    pending_generate: Number(statusCountMap.READY_TO_GENERATE || 0),
    pending_review: Number(statusCountMap.COMPILE_REVIEW_PENDING || 0)
      + Number(statusCountMap.TECH_REVIEW_PENDING || 0)
      + Number(statusCountMap.BUSINESS_REVIEW_PENDING || 0)
      + Number(statusCountMap.FINAL_REVIEW_PENDING || 0),
    ready_export: Number(statusCountMap.EXPORT_READY || 0),
  };

  res.json({
    user: req.user,
    permissions: buildPermissionSummary(req.user),
    stats: {
      bids: Number(bidCount?.count || 0),
      drafts: Number(activeDrafts?.count || 0),
      assets: Number(assetCount?.count || 0),
      enabled_models: Number(modelCount?.count || 0),
      kb_projects: Number(kbProjectCount?.count || 0),
      kb_chunks: Number(kbChunkCount?.count || 0),
    },
    workflow: {
      status_counts: statusCountMap,
      review_counts: reviewCountMap,
      todo,
    },
    governance: buildGovernancePayload(req.user),
  });
}));

app.get('/api/tender/kb/stats', requirePermission('tender:read'), asyncHandler(async (_req, res) => {
  const [
    projects,
    clauses,
    scoreItems,
    qualifications,
    specs,
    sectionAssets,
    cases,
    personnel,
    templates,
    rules,
    chunks,
    ingestJobs,
    linkedBids,
    linkedRequirements,
    linkedScoreItems,
    linkedEvidence,
    linkedSections,
    linkedTemplates,
    linkedMatches,
  ] = await Promise.all([
    get('SELECT COUNT(1) AS count FROM kb_projects'),
    get('SELECT COUNT(1) AS count FROM kb_tender_clauses'),
    get('SELECT COUNT(1) AS count FROM kb_score_items'),
    get('SELECT COUNT(1) AS count FROM kb_company_qualifications'),
    get('SELECT COUNT(1) AS count FROM kb_product_specs'),
    get('SELECT COUNT(1) AS count FROM kb_section_assets'),
    get('SELECT COUNT(1) AS count FROM kb_project_cases'),
    get('SELECT COUNT(1) AS count FROM kb_personnel_assets'),
    get('SELECT COUNT(1) AS count FROM kb_document_templates'),
    get('SELECT COUNT(1) AS count FROM kb_validation_rules'),
    get('SELECT COUNT(1) AS count FROM kb_asset_chunks'),
    get('SELECT COUNT(1) AS count FROM kb_ingest_jobs'),
    get('SELECT COUNT(1) AS count FROM tender_bids WHERE source_kb_project_id IS NOT NULL'),
    get('SELECT COUNT(1) AS count FROM tender_requirement_registry WHERE source_kb_clause_id IS NOT NULL'),
    get('SELECT COUNT(1) AS count FROM tender_score_coverage_matrix WHERE source_kb_score_item_id IS NOT NULL'),
    get('SELECT COUNT(1) AS count FROM tender_evidence_registry WHERE source_kb_id IS NOT NULL OR library_record_id IS NOT NULL'),
    get('SELECT COUNT(1) AS count FROM tender_draft_section_registry WHERE source_kb_section_asset_id IS NOT NULL'),
    get('SELECT COUNT(1) AS count FROM tender_doc_templates WHERE kb_template_id IS NOT NULL'),
    get('SELECT COUNT(1) AS count FROM tender_bid_generate_matches WHERE source_kb_case_id IS NOT NULL'),
  ]);

  res.json({
    knowledge_base: {
      projects: Number(projects?.count || 0),
      tender_clauses: Number(clauses?.count || 0),
      score_items: Number(scoreItems?.count || 0),
      company_qualifications: Number(qualifications?.count || 0),
      product_specs: Number(specs?.count || 0),
      section_assets: Number(sectionAssets?.count || 0),
      project_cases: Number(cases?.count || 0),
      personnel_assets: Number(personnel?.count || 0),
      document_templates: Number(templates?.count || 0),
      validation_rules: Number(rules?.count || 0),
      asset_chunks: Number(chunks?.count || 0),
      ingest_jobs: Number(ingestJobs?.count || 0),
    },
    runtime_links: {
      bids: Number(linkedBids?.count || 0),
      requirements: Number(linkedRequirements?.count || 0),
      score_items: Number(linkedScoreItems?.count || 0),
      evidence: Number(linkedEvidence?.count || 0),
      sections: Number(linkedSections?.count || 0),
      templates: Number(linkedTemplates?.count || 0),
      case_matches: Number(linkedMatches?.count || 0),
    },
  });
}));

app.get('/api/tender/kb/validation-rules', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const rules = await loadValidationRuleRows({
    ruleType: req.query?.rule_type,
    issueType: req.query?.issue_type,
    activeOnly: normalizeBoolean(req.query?.active_flag, true),
    limit: req.query?.limit,
  });
  res.json({
    items: rules,
    total: rules.length,
  });
}));

app.post('/api/tender/kb/validation-rules/sync', requirePermission('tender:config:manage'), asyncHandler(async (_req, res) => {
  const summary = await syncValidationRuleLibrary();
  res.json({
    ok: true,
    ...summary,
  });
}));

app.get('/api/tender/kb/projects', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 20);
  const offset = (page - 1) * limit;

  const keyword = trimText(req.query.keyword);
  const projectType = trimText(req.query.project_type);
  const industryType = trimText(req.query.industry_type);
  const resultStatus = normalizeKbResultStatus(req.query.result_status);

  const where = [];
  const params = [];

  if (keyword) {
    where.push('(project_name LIKE ? OR project_no LIKE ? OR purchaser LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (projectType) {
    where.push('project_type = ?');
    params.push(projectType);
  }
  if (industryType) {
    where.push('industry_type = ?');
    params.push(industryType);
  }
  if (trimText(req.query.result_status)) {
    where.push('result_status = ?');
    params.push(resultStatus || 'UNKNOWN');
  }
  appendScopedWhere(where, params, buildOwnerScopeWhere(req.user, 'created_by_id'));

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await get(`SELECT COUNT(1) AS total FROM kb_projects ${whereSql}`, params);
  const items = await query(
    `SELECT * FROM kb_projects ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: items.map((row) => sanitizeKbProjectRow(row)),
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.post('/api/tender/kb/projects', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const projectName = fixMojibakeText(trimText(req.body?.project_name));
  const projectNo = fixMojibakeText(trimText(req.body?.project_no));
  const purchaser = fixMojibakeText(trimText(req.body?.purchaser));
  const industryType = fixMojibakeText(trimText(req.body?.industry_type));
  const projectType = fixMojibakeText(trimText(req.body?.project_type));
  const region = fixMojibakeText(trimText(req.body?.region));
  const publishDateRaw = req.body?.publish_date;
  const bidDeadlineRaw = req.body?.bid_deadline;
  const resultStatus = normalizeKbResultStatus(req.body?.result_status);
  const remarks = fixMojibakeText(trimText(req.body?.remarks));
  const tags = req.body?.tags_json;

  if (!projectName) throw appError('项目名称不能为空', 400);

  const publishDate = normalizeDateTimeInput(publishDateRaw);
  const bidDeadline = normalizeDateTimeInput(bidDeadlineRaw);
  if (publishDateRaw !== undefined && publishDateRaw !== null && trimText(publishDateRaw) && !publishDate) {
    throw appError('publish_date 格式无效', 400);
  }
  if (bidDeadlineRaw !== undefined && bidDeadlineRaw !== null && trimText(bidDeadlineRaw) && !bidDeadline) {
    throw appError('bid_deadline 格式无效', 400);
  }

  const bidAmountNum = req.body?.bid_amount === undefined || req.body?.bid_amount === null || req.body?.bid_amount === ''
    ? null
    : Number(req.body?.bid_amount);
  if (bidAmountNum !== null && !Number.isFinite(bidAmountNum)) throw appError('bid_amount 格式无效', 400);

  const sourceBidIdNum = Number(req.body?.source_bid_id);
  const sourceBidId = Number.isFinite(sourceBidIdNum) && sourceBidIdNum > 0 ? Math.floor(sourceBidIdNum) : null;

  let tagsJson = null;
  if (tags !== undefined) {
    if (typeof tags === 'string') {
      const text = trimText(tags);
      if (text) {
        const parsed = parseMaybeJson(text, null);
        tagsJson = parsed !== null ? JSON.stringify(parsed) : JSON.stringify([text]);
      }
    } else if (Array.isArray(tags) || (tags && typeof tags === 'object')) {
      tagsJson = JSON.stringify(tags);
    }
  }

  const insert = await run(
    `INSERT INTO kb_projects
      (project_name, project_no, purchaser, industry_type, project_type, region, publish_date, bid_deadline, result_status, bid_amount, source_bid_id, tags_json, remarks, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectName,
      projectNo || null,
      purchaser || null,
      industryType || null,
      projectType || null,
      region || null,
      publishDate,
      bidDeadline,
      resultStatus || 'UNKNOWN',
      bidAmountNum,
      sourceBidId,
      tagsJson,
      remarks || null,
      Number(req.user.id),
      req.user.username,
      Number(req.user.id),
      req.user.username,
    ]
  );

  const row = await get('SELECT * FROM kb_projects WHERE id = ? LIMIT 1', [insert.insertId]);

  await logOperation({
    req,
    action: 'KB_PROJECT_CREATE',
    entity: 'kb_project',
    entityId: Number(insert.insertId),
    message: `创建知识库项目 ${projectName}`,
    afterData: {
      project_name: projectName,
      project_no: projectNo || null,
      result_status: resultStatus || 'UNKNOWN',
    },
  });

  res.status(201).json(sanitizeKbProjectRow(row));
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
  appendScopedWhere(where, params, buildBidScopeWhere(req.user, {
    idColumn: 'tender_bids.id',
    creatorColumn: 'tender_bids.created_by_id',
  }));

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await get(`SELECT COUNT(1) AS total FROM tender_bids ${whereSql}`, params);
  const rows = await query(
    `SELECT * FROM tender_bids ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: await withBidMembers(rows),
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.post('/api/tender/samples/upload', requirePermission('tender:write'), uploadSampleFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.path) throw appError('请上传历史投标样本文件', 400);

  const sourceExt = normalizeBidUploadExt(file.originalname || '') || path.extname(file.path).toLowerCase() || '.docx';
  const sourceFileName = fixMojibakeText(trimText(file.originalname) || path.basename(file.path));
  const title = fixMojibakeText(trimText(req.body?.title) || trimText(path.parse(sourceFileName).name) || `历史样本-${Date.now()}`);
  const sampleNo = await buildSampleNo();

  const insert = await run(
    `INSERT INTO tender_bid_samples
      (sample_no, title, original_file_name, source_ext, storage_path, file_size, mime_type, parse_status, status, uploaded_by_id, uploaded_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 'ACTIVE', ?, ?)`,
    [
      sampleNo,
      title,
      sourceFileName,
      sourceExt,
      file.path,
      Number(file.size || 0),
      trimText(file.mimetype) || guessMimeByExt(sourceExt),
      Number(req.user.id),
      req.user.username,
    ]
  );

  const sampleId = Number(insert.insertId);
  let parseStatus = 'SUCCESS';
  let parseError = '';
  let parsedText = '';
  let sections = [];
  let features = {};

  try {
    parsedText = await textByExtFromStorage({ sourcePath: file.path, sourceExt, maxLen: SAMPLE_PARSE_MAX_TEXT });
    if (!parsedText) throw appError('样本文本提取失败，请上传可复制文本的 doc/docx/pdf', 400);
    const split = splitTenderSections(parsedText);
    sections = split.sectionList;
    features = detectBidFeatures(parsedText);
    const manualBidCategory = normalizeBidCategory(req.body?.bid_category);
    if (manualBidCategory) features.bid_category = manualBidCategory;

    await transaction(async (tx) => {
      await tx.run(
        `UPDATE tender_bid_samples
         SET parse_status = 'SUCCESS', parse_error = NULL, parsed_text = ?, updated_at = NOW()
         WHERE id = ?`,
        [parsedText, sampleId]
      );
      await tx.run('DELETE FROM tender_bid_sample_sections WHERE sample_id = ?', [sampleId]);
      await tx.run('DELETE FROM tender_bid_sample_features WHERE sample_id = ?', [sampleId]);

      for (const section of sections) {
        await tx.run(
          `INSERT INTO tender_bid_sample_sections
            (sample_id, section_key, section_title, section_text, summary_text, keywords_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            sampleId,
            section.section_key,
            section.section_title,
            section.text || '',
            section.summary || '',
            JSON.stringify(extractKeywords(section.text || '', 20)),
          ]
        );
      }

      const featureRows = buildSampleFeatureRows(sampleId, {
        ...features,
        keywords: extractSampleKeywordsFromSections(sections),
      });
      for (const row of featureRows) {
        await tx.run(
          `INSERT INTO tender_bid_sample_features (sample_id, feature_key, feature_value, feature_weight)
           VALUES (?, ?, ?, ?)`,
          [row.sample_id, row.feature_key, row.feature_value, row.feature_weight]
        );
      }
    });
  } catch (err) {
    parseStatus = 'FAILED';
    parseError = trimText(err.message).slice(0, 2000) || '样本解析失败';
    await run(
      `UPDATE tender_bid_samples
       SET parse_status = 'FAILED', parse_error = ?, parsed_text = NULL, updated_at = NOW()
       WHERE id = ?`,
      [parseError, sampleId]
    );
  }

  const row = sanitizeSampleRow(await get('SELECT * FROM tender_bid_samples WHERE id = ? LIMIT 1', [sampleId]));
  const sectionRows = await loadSampleSections(sampleId);
  const featureRows = await query(
    `SELECT feature_key, feature_value, feature_weight
     FROM tender_bid_sample_features
     WHERE sample_id = ?
     ORDER BY id ASC`,
    [sampleId]
  );

  await logOperation({
    req,
    action: 'SAMPLE_UPLOAD',
    entity: 'sample',
    entityId: sampleId,
    message: `上传历史样本 ${sourceFileName}`,
    afterData: {
      sample_id: sampleId,
      sample_no: sampleNo,
      parse_status: parseStatus,
      parse_error: parseError || null,
      section_count: sectionRows.length,
    },
  });

  res.status(201).json({
    sample: row,
    sections: sectionRows,
    features: featureRows,
  });
}));

app.get('/api/tender/samples', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 10);
  const offset = (page - 1) * limit;
  const keyword = trimText(req.query.keyword);
  const status = trimText(req.query.status).toUpperCase();

  const where = [];
  const params = [];
  if (keyword) {
    where.push('(title LIKE ? OR original_file_name LIKE ? OR sample_no LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  appendScopedWhere(where, params, buildOwnerScopeWhere(req.user, 's.uploaded_by_id'));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await get(`SELECT COUNT(1) AS total FROM tender_bid_samples ${whereSql}`, params);
  const rows = await query(
    `SELECT s.*,
            (SELECT COUNT(1) FROM tender_bid_sample_sections t WHERE t.sample_id = s.id) AS section_count
     FROM tender_bid_samples s
     ${whereSql}
     ORDER BY s.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: rows.map((item) => sanitizeSampleRow(item)),
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.delete('/api/tender/samples/:id', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('样本ID无效', 400);

  const sample = sanitizeSampleRow(await get('SELECT * FROM tender_bid_samples WHERE id = ? LIMIT 1', [id]));
  if (!sample) throw appError('样本不存在', 404);
  if (resolveDataScope(req.user) === 'OWNED_OR_ASSIGNED' && Number(sample.uploaded_by_id || 0) !== Number(req.user.id || 0)) {
    throw bidScopeForbiddenError('当前账号无权删除该样本');
  }

  await withDeadlockRetry(
    () => transaction(async (tx) => {
      await tx.run('DELETE FROM tender_bid_generate_matches WHERE sample_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_sample_features WHERE sample_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_sample_sections WHERE sample_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_samples WHERE id = ?', [id]);
    }),
    { maxRetries: 2, baseDelayMs: 100 }
  );
  await deleteFileSafe(sample.storage_path);

  try {
    await withDeadlockRetry(
      () => logOperation({
        req,
        action: 'SAMPLE_DELETE',
        entity: 'sample',
        entityId: id,
        message: `删除历史样本 ${sample.original_file_name}`,
        beforeData: sample,
        afterData: { deleted: true },
      }),
      { maxRetries: 2, baseDelayMs: 100 }
    );
  } catch (err) {
    console.error('[tender] sample delete log failed:', err?.message || err);
  }

  res.json({ ok: true, id });
}));

app.get('/api/tender/doc-templates', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const canManage = hasPermission(req.user, 'tender:config:manage');
  const whereSql = canManage ? '' : 'WHERE status = \'ACTIVE\'';
  const rows = await query(
    `SELECT *
     FROM tender_doc_templates
     ${whereSql}
     ORDER BY is_default DESC, id DESC`
  );
  res.json(rows.map((item) => sanitizeDocTemplateRow(item)));
}));

app.post('/api/tender/doc-templates/upload', requirePermission('tender:config:manage'), uploadDocTemplateFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.path) throw appError('请上传投标模板文件', 400);

  const sourceExt = normalizeDocTemplateExt(file.originalname || '') || '.docx';
  const sourceFileName = fixMojibakeText(trimText(file.originalname) || path.basename(file.path));
  const templateName = fixMojibakeText(trimText(req.body?.template_name || req.body?.name) || trimText(path.parse(sourceFileName).name) || `投标模板-${Date.now()}`);
  const isDefaultRequested = normalizeBoolean(req.body?.is_default, false);
  const templateNo = await buildDocTemplateNo();

  let insertedId = 0;
  await transaction(async (tx) => {
    const total = await tx.get('SELECT COUNT(1) AS count FROM tender_doc_templates');
    const shouldDefault = isDefaultRequested || Number(total?.count || 0) === 0;
    if (shouldDefault) {
      await tx.run('UPDATE tender_doc_templates SET is_default = 0 WHERE is_default = 1');
    }
    const inserted = await tx.run(
      `INSERT INTO tender_doc_templates
        (template_no, template_name, original_file_name, source_ext, storage_path, file_size, mime_type, status, is_default, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      [
        templateNo,
        templateName,
        sourceFileName,
        sourceExt,
        file.path,
        Number(file.size || 0),
        trimText(file.mimetype) || guessMimeByExt(sourceExt),
        shouldDefault ? 1 : 0,
        Number(req.user.id),
        req.user.username,
        Number(req.user.id),
        req.user.username,
      ]
    );
    insertedId = Number(inserted.insertId || 0);
  });

  const row = sanitizeDocTemplateRow(await get('SELECT * FROM tender_doc_templates WHERE id = ? LIMIT 1', [insertedId]));
  await logOperation({
    req,
    action: 'DOC_TEMPLATE_UPLOAD',
    entity: 'doc_template',
    entityId: insertedId,
    message: `上传投标模板 ${templateName}`,
    afterData: row,
  });

  res.status(201).json(row);
}));

app.put('/api/tender/doc-templates/:id', requirePermission('tender:config:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模板ID无效', 400);

  const before = sanitizeDocTemplateRow(await get('SELECT * FROM tender_doc_templates WHERE id = ? LIMIT 1', [id]));
  if (!before) throw appError('模板不存在', 404);

  const templateName = req.body?.template_name === undefined ? before.template_name : fixMojibakeText(trimText(req.body?.template_name || req.body?.name));
  if (!templateName) throw appError('模板名称不能为空', 400);
  const status = req.body?.status === undefined ? trimText(before.status || 'ACTIVE').toUpperCase() : trimText(req.body?.status).toUpperCase();
  if (!['ACTIVE', 'DISABLED'].includes(status)) throw appError('模板状态不合法', 400);
  const setDefault = req.body?.is_default === undefined ? Number(before.is_default || 0) === 1 : normalizeBoolean(req.body?.is_default, false);

  await transaction(async (tx) => {
    if (setDefault) {
      await tx.run('UPDATE tender_doc_templates SET is_default = 0 WHERE is_default = 1');
    }
    await tx.run(
      `UPDATE tender_doc_templates
       SET template_name = ?, status = ?, is_default = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [templateName, status, setDefault ? 1 : 0, Number(req.user.id), req.user.username, id]
    );

    if (!setDefault && Number(before.is_default || 0) === 1) {
      const fallback = await tx.get('SELECT id FROM tender_doc_templates WHERE id <> ? AND status = \'ACTIVE\' ORDER BY id ASC LIMIT 1', [id]);
      if (fallback) {
        await tx.run('UPDATE tender_doc_templates SET is_default = 1 WHERE id = ?', [Number(fallback.id)]);
      }
    }
  });

  const row = sanitizeDocTemplateRow(await get('SELECT * FROM tender_doc_templates WHERE id = ? LIMIT 1', [id]));
  await logOperation({
    req,
    action: 'DOC_TEMPLATE_UPDATE',
    entity: 'doc_template',
    entityId: id,
    message: `更新投标模板 ${before.template_name}`,
    beforeData: before,
    afterData: row,
  });

  res.json(row);
}));

app.delete('/api/tender/doc-templates/:id', requirePermission('tender:config:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模板ID无效', 400);

  const before = sanitizeDocTemplateRow(await get('SELECT * FROM tender_doc_templates WHERE id = ? LIMIT 1', [id]));
  if (!before) throw appError('模板不存在', 404);

  let switchedDefaultId = null;
  await transaction(async (tx) => {
    const countRow = await tx.get('SELECT COUNT(1) AS count FROM tender_doc_templates');
    if (Number(countRow?.count || 0) <= 1) throw appError('至少保留一个模板，不能全部删除', 400);

    const current = await tx.get('SELECT * FROM tender_doc_templates WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!current) throw appError('模板不存在', 404);
    if (Number(current.is_default || 0) === 1) {
      const fallback = await tx.get(
        'SELECT id FROM tender_doc_templates WHERE id <> ? AND status = \'ACTIVE\' ORDER BY id ASC LIMIT 1',
        [id]
      );
      if (!fallback) throw appError('默认模板不能删除，请先启用并设置其他默认模板', 400);
      switchedDefaultId = Number(fallback.id);
    }

    await tx.run('DELETE FROM tender_doc_templates WHERE id = ?', [id]);

    if (switchedDefaultId) {
      await tx.run('UPDATE tender_doc_templates SET is_default = 0 WHERE is_default = 1');
      await tx.run('UPDATE tender_doc_templates SET is_default = 1 WHERE id = ?', [switchedDefaultId]);
      return;
    }

    const hasDefault = await tx.get('SELECT id FROM tender_doc_templates WHERE is_default = 1 LIMIT 1');
    if (!hasDefault) {
      const fallback = await tx.get('SELECT id FROM tender_doc_templates WHERE status = \'ACTIVE\' ORDER BY id ASC LIMIT 1');
      if (fallback) {
        switchedDefaultId = Number(fallback.id);
        await tx.run('UPDATE tender_doc_templates SET is_default = 1 WHERE id = ?', [switchedDefaultId]);
      }
    }
  });
  await deleteFileSafe(before.storage_path);

  await logOperation({
    req,
    action: 'DOC_TEMPLATE_DELETE',
    entity: 'doc_template',
    entityId: id,
    message: switchedDefaultId
      ? `删除投标模板 ${before.template_name}，默认模板切换为ID=${switchedDefaultId}`
      : `删除投标模板 ${before.template_name}`,
    beforeData: before,
    afterData: switchedDefaultId ? { switched_default_template_id: switchedDefaultId } : { deleted: true },
  });

  res.json({
    ok: true,
    id,
    switched_default_template_id: switchedDefaultId,
  });
}));

app.get('/api/tender/bids/generate/jobs', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const page = toPositiveInt(req.query.page, 1);
  const limit = toBoundedLimit(req.query.limit, 10);
  const offset = (page - 1) * limit;
  const keyword = trimText(req.query.keyword);
  const status = trimText(req.query.status).toUpperCase();

  const where = [];
  const params = [];
  if (keyword) {
    where.push('(source_file_name LIKE ? OR warning_text LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  appendScopedWhere(where, params, buildOwnerScopeWhere(req.user, 'operator_id'));

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await get(`SELECT COUNT(1) AS total FROM tender_bid_generate_jobs ${whereSql}`, params);
  const rows = await query(
    `SELECT *
     FROM tender_bid_generate_jobs
     ${whereSql}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    items: rows.map((item) => sanitizeGenerateJobRow(item)),
    total: Number(total?.total || 0),
    page,
    limit,
  });
}));

app.delete('/api/tender/bids/generate/jobs/:id', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('任务ID无效', 400);

  const before = await get('SELECT * FROM tender_bid_generate_jobs WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('任务不存在', 404);
  if (resolveDataScope(req.user) === 'OWNED_OR_ASSIGNED' && Number(before.operator_id || 0) !== Number(req.user.id || 0)) {
    throw bidScopeForbiddenError('当前账号无权删除该解析任务');
  }
  const status = String(trimText(before.status)).toUpperCase();
  if (status === 'ANALYZING') throw appError('任务正在分析中，暂不能删除', 409);

  await withDeadlockRetry(
    () => transaction(async (tx) => {
      await tx.run('DELETE FROM tender_bid_generate_matches WHERE job_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_generate_items WHERE job_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_generate_jobs WHERE id = ?', [id]);
    }),
    { maxRetries: 2, baseDelayMs: 100 }
  );

  const sourcePath = trimText(before.source_storage_path);
  if (sourcePath) {
    const refs = await get(
      `SELECT
         (SELECT COUNT(1) FROM tender_bid_generate_jobs WHERE source_storage_path = ?) AS job_ref_count,
         (SELECT COUNT(1) FROM tender_assets WHERE storage_path = ?) AS asset_ref_count`,
      [sourcePath, sourcePath]
    );
    const jobRefCount = Number(refs?.job_ref_count || 0);
    const assetRefCount = Number(refs?.asset_ref_count || 0);
    if (jobRefCount <= 0 && assetRefCount <= 0) {
      await deleteFileSafe(sourcePath);
    }
  }

  await logOperation({
    req,
    action: 'BID_ANALYZE_DELETE',
    entity: 'generate_job',
    entityId: id,
    message: `删除分析任务 ${trimText(before.source_file_name) || `#${id}`}`,
    beforeData: {
      source_file_name: trimText(before.source_file_name),
      bid_category: normalizeBidCategory(before.bid_category) || trimText(before.bid_category),
      status: trimText(before.status),
      model_id: Number(before.model_id || 0) || null,
      model_name: trimText(before.model_name),
      created_bid_id: Number(before.created_bid_id || 0) || null,
    },
    afterData: { deleted: true },
  });

  res.json({ ok: true, id });
}));

app.get('/api/tender/bids/generate/jobs/:id', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('任务ID无效', 400);
  const detail = await loadGenerateJobDetail(id);
  if (!detail) throw appError('任务不存在', 404);
  if (resolveDataScope(req.user) === 'OWNED_OR_ASSIGNED' && Number(detail.job?.operator_id || 0) !== Number(req.user.id || 0)) {
    throw bidScopeForbiddenError('当前账号无权查看该解析任务');
  }
  const requirementRegistry = await loadRequirementRegistryRows(id);
  const clauseRegistryV2 = buildClauseRegistryV2({
    requirements: requirementRegistry,
  });
  const sectionSummaries = parseMaybeJson(detail.job.section_summaries_json, []);
  const analysisSummary = parseMaybeJson(detail.job.analysis_summary_json, {});
  const tableSummaries = Array.isArray(analysisSummary?.table_summaries)
    ? analysisSummary.table_summaries
    : [];
  const stageOutputsRaw = isPlainObject(analysisSummary?.stage_outputs) ? analysisSummary.stage_outputs : {};
  const scoreTableExtract = isPlainObject(stageOutputsRaw.score_table_extract)
    ? stageOutputsRaw.score_table_extract
    : {
      table_extracted_count: 0,
      fallback_extracted_count: 0,
      merged_count: 0,
      fallback_merged_count: 0,
      merged_total_count: 0,
    };
  const productParamExtract = isPlainObject(stageOutputsRaw.product_param_extract)
    ? stageOutputsRaw.product_param_extract
    : {
      table_param_extracted_count: 0,
      table_param_merged_count: 0,
    };
  const parseQualityGate = isPlainObject(stageOutputsRaw.parse_quality_gate)
    ? stageOutputsRaw.parse_quality_gate
    : {
      status: 'WARN',
      allow_generate: true,
      checks: {},
      blocking_issues: ['无'],
      warning_issues: ['无'],
    };
  const evidenceRegistry = isPlainObject(stageOutputsRaw.evidence_registry)
    ? stageOutputsRaw.evidence_registry
    : {
      stage1_risk_clauses: [],
      stage3_missing_items: [],
      scoring_items: [],
      risk_items: [],
    };
  const stageClauseRegistry = Array.isArray(stageOutputsRaw.clause_registry_v2)
    ? stageOutputsRaw.clause_registry_v2
    : clauseRegistryV2;
  const ruleScanSummary = isPlainObject(stageOutputsRaw.rule_scan_summary)
    ? stageOutputsRaw.rule_scan_summary
    : {
      categories: [],
      missing_items: [],
    };
  const stage1RiskClauses = normalizeStage1RiskClauses(stageOutputsRaw.stage1_risk_clauses || []);
  const stage3MissingItems = normalizeStage3MissingItems(stageOutputsRaw.stage3_missing_items || []);
  const requiredChapterScan = Array.isArray(stageOutputsRaw.required_chapter_scan)
    ? stageOutputsRaw.required_chapter_scan
    : (Array.isArray(analysisSummary.required_chapter_scan)
      ? analysisSummary.required_chapter_scan
      : buildRequiredChapterScan(
        Array.isArray(sectionSummaries)
          ? sectionSummaries.map((item) => ({
            section_key: trimText(item?.section_key),
            text: trimText(item?.summary),
          }))
          : []
      ));
  const bidCategory = normalizeBidCategory(detail?.job?.bid_category) || 'SERVICE';
  const finalJson = normalizeFinalAnalyzeJson(analysisSummary?.final_json || {}, bidCategory);
  const scoringItems = detail.items.filter((item) => item.item_type === 'SCORING');
  const riskItems = detail.items.filter((item) => item.item_type === 'RISK');
  const generatedArtifacts = isPlainObject(analysisSummary?.generated_artifacts)
    ? analysisSummary.generated_artifacts
    : buildGeneratedArtifacts({
      finalJson,
      stage1RiskClauses,
      riskItems,
      scoringItems,
      bidCategory,
    });
  const chapterQualitySummary = isPlainObject(stageOutputsRaw.chapter_quality_summary)
    ? stageOutputsRaw.chapter_quality_summary
    : null;

  res.json({
    job: detail.job,
    section_summaries: sectionSummaries,
    table_summaries: tableSummaries,
    scoring_items: scoringItems,
    risk_items: riskItems,
    matches: detail.matches,
    final_json: finalJson,
    requirement_registry: requirementRegistry,
    clause_registry_v2: clauseRegistryV2,
    stage_outputs: {
      stage1_risk_clauses: stage1RiskClauses,
      stage3_missing_items: stage3MissingItems,
      required_chapter_scan: requiredChapterScan,
      parse_quality_gate: parseQualityGate,
      score_table_extract: scoreTableExtract,
      product_param_extract: productParamExtract,
      rule_scan_summary: ruleScanSummary,
      evidence_registry: evidenceRegistry,
      clause_registry_v2: stageClauseRegistry,
      chapter_quality_summary: chapterQualitySummary,
    },
    generated_artifacts: generatedArtifacts,
    chapter_quality_summary: chapterQualitySummary,
  });
}));

app.get('/api/tender/bids/generate/jobs/:id/source/editor/session', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('任务ID无效', 400);
  const detail = await loadGenerateJobDetail(id);
  if (!detail) throw appError('任务不存在', 404);

  const sourcePath = trimText(detail?.job?.source_storage_path);
  const sourceExt = normalizeBidUploadExt(detail?.job?.source_ext)
    || path.extname(sourcePath).toLowerCase();
  if (!sourcePath) throw appError('源文件不存在', 404);
  if (!['.doc', '.docx'].includes(sourceExt)) {
    throw appError('当前仅支持 doc/docx 预览', 400);
  }

  const sourceToken = jwt.sign(
    {
      type: 'tender_generate_source',
      jobId: Number(id),
    },
    DOC_EDITOR_JWT_SECRET,
    { expiresIn: '2h' }
  );
  const sourceUrl = `${DOC_EDITOR_FILE_BASE_URL}/api/tender/bids/generate/jobs/${id}/source/download.docx?token=${encodeURIComponent(sourceToken)}`;
  const editor = buildOnlyOfficeGenerateSourcePreviewConfig({
    job: detail.job,
    sourceUrl,
    user: req.user,
  });

  res.json({
    job: detail.job,
    editor,
  });
}));

app.get('/api/tender/bids/generate/jobs/:id/source/download.docx', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('任务ID无效', 400);

  const payload = verifyDraftAccessToken(req.query.token || req.params.accessToken);
  if (trimText(payload?.type) !== 'tender_generate_source' || Number(payload?.jobId) !== id) {
    throw appError('访问令牌无效', 401);
  }

  const detail = await loadGenerateJobDetail(id);
  if (!detail) throw appError('任务不存在', 404);

  const sourcePath = trimText(detail?.job?.source_storage_path);
  const sourceExt = normalizeBidUploadExt(detail?.job?.source_ext)
    || path.extname(sourcePath).toLowerCase();
  if (!sourcePath) throw appError('源文件不存在', 404);
  if (!['.doc', '.docx'].includes(sourceExt)) throw appError('当前仅支持 doc/docx 预览', 400);

  const sourceFileName = fixMojibakeText(trimText(detail?.job?.source_file_name)) || `招标文件-${id}.docx`;
  const previewName = sourceFileName.toLowerCase().endsWith('.docx')
    ? sourceFileName
    : `${path.parse(sourceFileName).name || `招标文件-${id}`}.docx`;

  if (sourceExt === '.docx') {
    const stat = await readFileStatSafe(sourcePath);
    if (!stat?.isFile()) throw appError('源文件不存在', 404);
    res.setHeader('Content-Type', guessMimeByExt('.docx'));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(previewName)}`);
    res.sendFile(path.resolve(sourcePath));
    return;
  }

  const tempDir = path.join(EDITABLE_ROOT, `generate-preview-${Date.now()}-${crypto.randomUUID()}`);
  let convertedPath = '';
  try {
    convertedPath = await runLibreOfficeConvert(sourcePath, tempDir, 'docx');
    res.setHeader('Content-Type', guessMimeByExt('.docx'));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(previewName)}`);
    res.sendFile(path.resolve(convertedPath), async () => {
      await deleteFileSafe(convertedPath);
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
  } catch (err) {
    if (convertedPath) await deleteFileSafe(convertedPath);
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}));

app.post('/api/tender/bids/generate/analyze', requirePermission('tender:write'), uploadTenderSourceFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.path) throw appError('请上传招标文件', 400);

  const sourceExt = normalizeBidUploadExt(file.originalname || '') || path.extname(file.path).toLowerCase() || '.docx';
  const sourceFileName = fixMojibakeText(trimText(file.originalname) || path.basename(file.path));
  const bidCategory = normalizeBidCategory(req.body?.bid_category);
  if (!bidCategory) throw appError('请选择招标类型（服务类/产品类）', 400);
  const requestedModelId = Number(req.body?.model_id);
  const model = await resolveModel(requestedModelId);

  const created = await run(
    `INSERT INTO tender_bid_generate_jobs
      (source_file_name, source_storage_path, source_ext, source_mime_type, source_file_size, model_id, model_name, bid_category, status, progress, operator_id, operator_name, request_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ANALYZING', 10, ?, ?, ?)`,
    [
      sourceFileName,
      file.path,
      sourceExt,
      trimText(file.mimetype) || guessMimeByExt(sourceExt),
      Number(file.size || 0),
      Number(model.id),
      trimText(model.name),
      bidCategory,
      Number(req.user.id),
      req.user.username,
      trimText(getClientIp(req)),
    ]
  );
  const jobId = Number(created.insertId);

  await logOperation({
    req,
    action: 'BID_ANALYZE_START',
    entity: 'generate_job',
    entityId: jobId,
    message: `开始分析招标文件 ${sourceFileName}`,
    afterData: {
      source_file_name: sourceFileName,
      model_id: model.id,
      model_name: model.name,
      bid_category: bidCategory,
      bid_category_label: bidCategoryLabel(bidCategory),
    },
  });

  try {
    const sourceText = await textByExtFromStorage({ sourcePath: file.path, sourceExt, maxLen: BID_ANALYZE_MAX_TEXT });
    if (!sourceText) throw appError('文本提取失败，请上传可复制文字的 doc/docx/pdf 文件', 400);

    const split = splitTenderSections(sourceText);
    const extractedTables = await tablesByExtFromStorage({ sourcePath: file.path, sourceExt, sourceText });
    const tableSummaries = buildTableSummaries({ tables: extractedTables, sectionList: split.sectionList });
    const baseRule = buildRuleAnalyzeItems({ sectionList: split.sectionList });
    const detectedFeatures = detectBidFeatures(sourceText);
    const features = {
      ...detectedFeatures,
      bid_category: bidCategory,
    };
    const sectionSummaries = split.sectionList.map((item) => ({
      section_key: item.section_key,
      section_title: item.section_title,
      summary: item.summary,
    }));

    const sampleRows = await query(
      `SELECT s.id, s.sample_no, s.title, s.original_file_name,
              (SELECT COUNT(1) FROM tender_bid_sample_sections ss WHERE ss.sample_id = s.id) AS section_count
       FROM tender_bid_samples s
       WHERE s.status = 'ACTIVE' AND s.parse_status = 'SUCCESS'
       ORDER BY s.id DESC
       LIMIT ?`,
      [SAMPLE_MATCH_CANDIDATE_LIMIT]
    );

    const normalizedSamples = [];
    for (const row of sampleRows) {
      const feature = await loadSampleFeatures(row.id);
      normalizedSamples.push({
        ...sanitizeSampleRow(row),
        keywords: Array.isArray(feature.keywords) ? feature.keywords : [],
        project_type: trimText(feature.project_type),
        industry: trimText(feature.industry),
        procurement_mode: trimText(feature.procurement_mode),
        bid_category: normalizeBidCategory(feature.bid_category),
      });
    }
    const matched = rankMatchedSamples({
      analyzeFeatures: features,
      analyzeSections: split.sectionList,
      samples: normalizedSamples,
    });
    const topCandidates = matched.slice(0, 10);

    const warnings = [];
    if (!tableSummaries.length) {
      warnings.push('未识别到结构化表格，将按正文条款继续分析。');
    }
    let rankedMatches = topCandidates.slice(0, 3);
    if (rankedMatches.length < 3) {
      warnings.push(`样本库可用样本不足3份，当前仅匹配到 ${rankedMatches.length} 份。`);
    }
    const requiredChapterScan = buildRequiredChapterScan(split.sectionList);
    const preflightGate = buildAnalyzeQualityGate({
      sourceText,
      requiredChapterScan,
      tableSummaries,
      bidCategory,
      preflightOnly: true,
    });
    if (preflightGate.status === 'BLOCK') {
      throw appError(`解析门禁未通过：${preflightGate.blocking_issues.filter((item) => item && item !== '无').join('；') || '请更换可解析招标文件'}`, 400);
    }
    for (const item of preflightGate.warning_issues || []) {
      if (item && item !== '无') warnings.push(`预检提醒：${item}`);
    }

    let stage1RiskClauses = [];
    let stage2FinalJson = normalizeFinalAnalyzeJson({
      project_core_info: {
        project_type: bidCategoryLabel(bidCategory),
      },
    }, bidCategory);
    let stage3MissingItems = [];
    const stageTaskLogIds = {
      stage1: null,
      stage2: null,
      stage3: null,
    };

    const stage1Input = {
      bid_category: bidCategory,
      bid_category_label: bidCategoryLabel(bidCategory),
      required_chapters: REQUIRED_ANALYZE_CHAPTERS.map((item) => ({ key: item.key, title: item.title })),
      section_summaries: sectionSummaries,
      extracted_tables: tableSummaries,
      full_text: sourceText,
    };
    try {
      const stage1Task = await runAiTask({
        req,
        taskType: ANALYZE_STAGE_TASK_TYPES.STAGE1,
        modelId: Number(model.id),
        inputText: JSON.stringify(stage1Input),
        extraSystemPrompt: buildStage1EnforcedRules(bidCategory),
      });
      stageTaskLogIds.stage1 = Number(stage1Task.task_log_id || 0) || null;
      const stage1Parsed = isPlainObject(stage1Task.parsed) ? stage1Task.parsed : {};
      stage1RiskClauses = enrichStage1RiskClausesBySource(stage1Parsed.risk_clauses || [], split.sectionList);
    } catch (err) {
      warnings.push(`第一阶段风险扫描失败，已继续后续流程：${trimText(err.message).slice(0, 120)}`);
    }
    const ruleScannedRiskClauses = scanRiskClausesByKeywords(split.sectionList, bidCategory);
    stage1RiskClauses = enrichStage1RiskClausesBySource([...stage1RiskClauses, ...ruleScannedRiskClauses], split.sectionList);
    if (ruleScannedRiskClauses.length > 0) {
      warnings.push(`已启用关键词兜底扫描，补充风险条款 ${ruleScannedRiskClauses.length} 条。`);
    }

    const stage2Input = {
      bid_category: bidCategory,
      bid_category_label: bidCategoryLabel(bidCategory),
      required_chapter_scan: requiredChapterScan,
      section_summaries: sectionSummaries,
      extracted_tables: tableSummaries,
      stage1_risk_clauses: stage1RiskClauses,
      final_json_schema: createFinalAnalyzeSchema(bidCategory),
      full_text: sourceText,
    };
    try {
      const stage2Task = await runAiTask({
        req,
        taskType: ANALYZE_STAGE_TASK_TYPES.STAGE2,
        modelId: Number(model.id),
        inputText: JSON.stringify(stage2Input),
        extraSystemPrompt: buildStage2EnforcedRules(bidCategory),
      });
      stageTaskLogIds.stage2 = Number(stage2Task.task_log_id || 0) || null;
      stage2FinalJson = normalizeFinalAnalyzeJson(stage2Task.parsed || {}, bidCategory);
      stage2FinalJson.project_core_info.project_type = bidCategoryLabel(bidCategory);
    } catch (err) {
      warnings.push(`第二阶段结构化解析失败，已使用兜底结构：${trimText(err.message).slice(0, 120)}`);
    }

    const stage3Input = {
      bid_category: bidCategory,
      bid_category_label: bidCategoryLabel(bidCategory),
      stage1_risk_clauses: stage1RiskClauses,
      stage2_final_json: stage2FinalJson,
      extracted_tables: tableSummaries,
      full_text: sourceText,
    };
    try {
      const stage3Task = await runAiTask({
        req,
        taskType: ANALYZE_STAGE_TASK_TYPES.STAGE3,
        modelId: Number(model.id),
        inputText: JSON.stringify(stage3Input),
        extraSystemPrompt: buildStage3EnforcedRules(bidCategory),
      });
      stageTaskLogIds.stage3 = Number(stage3Task.task_log_id || 0) || null;
      const stage3Parsed = isPlainObject(stage3Task.parsed) ? stage3Task.parsed : {};
      stage3MissingItems = enrichStage3MissingItemsBySource(stage3Parsed.missing_items || [], split.sectionList);
    } catch (err) {
      warnings.push(`第三阶段交叉校验失败，已输出前两阶段结果：${trimText(err.message).slice(0, 120)}`);
    }

    const mergedByStagesFinalJson = mergeAnalyzeFinalJson({
      stage2FinalJson,
      stage1RiskClauses,
      stage3MissingItems,
      bidCategory,
    });
    const scoreMergeResult = mergeScoreItemsIntoFinalJson({
      finalJson: mergedByStagesFinalJson,
      tableSummaries,
      ruleScoringItems: baseRule.scoring_items,
      bidCategory,
    });
    let finalJson = scoreMergeResult.final_json;
    let productParamMergeResult = {
      table_param_extracted_count: 0,
      table_param_merged_count: 0,
    };
    if (bidCategory === 'PRODUCT') {
      productParamMergeResult = mergeProductParametersIntoFinalJson({
        finalJson,
        tableSummaries,
      });
      finalJson = productParamMergeResult.final_json;
      if (productParamMergeResult.table_param_extracted_count > 0) {
        warnings.push(
          `技术参数逐条提取：识别 ${productParamMergeResult.table_param_extracted_count} 条，合并 ${productParamMergeResult.table_param_merged_count} 条。`
        );
      } else {
        warnings.push('技术参数表未识别到结构化参数，请在核对环节人工补充。');
      }
    }
    if (scoreMergeResult.table_extracted_count > 0) {
      warnings.push(
        `评分表逐条提取：识别 ${scoreMergeResult.table_extracted_count} 条，表格合并 ${scoreMergeResult.merged_count} 条，兜底补充 ${scoreMergeResult.fallback_merged_count} 条。`
      );
    } else {
      warnings.push(`评分表未识别到结构化条目，已用正文规则兜底提取 ${scoreMergeResult.fallback_extracted_count} 条评分项。`);
    }
    const ruleCoverageSummary = buildRuleCoverageSummary({
      sectionList: split.sectionList,
      bidCategory,
      stage1RiskClauses,
      scoreExtract: {
        merged_count: scoreMergeResult.merged_count,
        merged_total_count: scoreMergeResult.merged_total_count,
      },
    });
    if (Array.isArray(ruleCoverageSummary.missing_items) && ruleCoverageSummary.missing_items.length > 0) {
      stage3MissingItems = enrichStage3MissingItemsBySource(
        [...stage3MissingItems, ...ruleCoverageSummary.missing_items],
        split.sectionList
      );
      finalJson = mergeAnalyzeFinalJson({
        stage2FinalJson: finalJson,
        stage1RiskClauses,
        stage3MissingItems,
        bidCategory,
      });
      warnings.push(`规则引擎兜底补充遗漏项 ${ruleCoverageSummary.missing_items.length} 条。`);
    }
    const fallbackFillResult = enrichAnalyzeFinalJsonByRules({
      finalJson,
      sectionList: split.sectionList,
      bidCategory,
    });
    finalJson = fallbackFillResult.final_json;
    if (Number(fallbackFillResult.filled_count || 0) > 0) {
      warnings.push(`规则引擎补全商务/技术条款 ${fallbackFillResult.filled_count} 项。`);
    }
    let scoringItems = buildScoringItemsFromFinalJson(finalJson);
    let riskItems = buildRiskItemsFromFinalJson({ finalJson, stage1RiskClauses, bidCategory });
    if (!scoringItems.length) scoringItems = baseRule.scoring_items;
    if (!riskItems.length) riskItems = baseRule.risk_items;
    scoringItems = enrichGenerateItemsBySource(scoringItems, split.sectionList);
    riskItems = enrichGenerateItemsBySource(riskItems, split.sectionList);
    const generatedArtifacts = buildGeneratedArtifacts({
      finalJson,
      stage1RiskClauses,
      riskItems,
      scoringItems,
      bidCategory,
    });
    const qualityGate = buildAnalyzeQualityGate({
      sourceText,
      requiredChapterScan,
      tableSummaries,
      stage1RiskClauses,
      scoreExtract: {
        merged_total_count: scoreMergeResult.merged_total_count,
        merged_count: scoreMergeResult.merged_count,
      },
      productParamExtract: productParamMergeResult,
      bidCategory,
      preflightOnly: false,
    });
    for (const item of qualityGate.warning_issues || []) {
      if (item && item !== '无') warnings.push(`门禁提醒：${item}`);
    }
    const evidenceRegistry = {
      stage1_risk_clauses: stage1RiskClauses.map((item) => ({
        evidence_id: item.evidence_id,
        clause_type: item.clause_type,
        clause_content: item.clause_content,
        source_reference: item.source_reference,
      })),
      stage3_missing_items: stage3MissingItems.map((item) => ({
        item_type: item.item_type,
        missing_content: item.missing_content,
        source_reference: item.source_reference,
      })),
      scoring_items: scoringItems.map((item, idx) => ({
        item_no: idx + 1,
        title: item.title,
        source_reference: item.source_reference,
      })),
      risk_items: riskItems.map((item, idx) => ({
        item_no: idx + 1,
        title: item.title,
        source_reference: item.source_reference,
      })),
    };
    const requirementRegistry = buildRequirementRows({
      jobId,
      bidCategory,
      finalJson,
      scoringItems,
      stage1RiskClauses,
      tableSummaries,
    });
    const clauseRegistryV2 = buildClauseRegistryV2({
      requirements: requirementRegistry,
    });

    const stageOutputs = {
      stage1_risk_clauses: stage1RiskClauses,
      stage3_missing_items: stage3MissingItems,
      required_chapter_scan: requiredChapterScan,
      parse_quality_gate: qualityGate,
      score_table_extract: {
        table_extracted_count: scoreMergeResult.table_extracted_count,
        fallback_extracted_count: scoreMergeResult.fallback_extracted_count,
        merged_count: scoreMergeResult.merged_count,
        fallback_merged_count: scoreMergeResult.fallback_merged_count,
        merged_total_count: scoreMergeResult.merged_total_count,
      },
      product_param_extract: productParamMergeResult,
      rule_scan_summary: ruleCoverageSummary,
      evidence_registry: evidenceRegistry,
      clause_registry_v2: clauseRegistryV2,
    };

    const summaryPayload = {
      ...composeAnalysisSummary({
        sections: sectionSummaries,
        tables: tableSummaries,
        scoringItems,
        riskItems,
        warnings,
      }),
      bid_category: bidCategory,
      bid_category_label: bidCategoryLabel(bidCategory),
      stage_outputs: stageOutputs,
      table_summaries: tableSummaries,
      final_json: finalJson,
      generated_artifacts: generatedArtifacts,
      clause_registry_v2: clauseRegistryV2,
      candidate_samples: topCandidates.map((item) => ({
        sample_id: item.sample_id,
        sample_no: item.sample_no,
        title: item.title,
        score: item.score,
        reason: item.reason,
      })),
    };

    await transaction(async (tx) => {
      await tx.run(
        `UPDATE tender_bid_generate_jobs
         SET status = 'ANALYZED', progress = 60, section_summaries_json = ?, analysis_summary_json = ?, warning_text = ?, updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(sectionSummaries), JSON.stringify(summaryPayload), warnings.join('；') || null, jobId]
      );
      await persistRequirementRegistry(tx, jobId, requirementRegistry);
      await tx.run('DELETE FROM tender_bid_generate_items WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM tender_bid_generate_matches WHERE job_id = ?', [jobId]);

      for (let i = 0; i < scoringItems.length; i += 1) {
        const item = scoringItems[i];
        await tx.run(
          `INSERT INTO tender_bid_generate_items
            (job_id, item_type, section_key, section_title, title, evidence_text, suggestion_text, risk_level, sort_order)
           VALUES (?, 'SCORING', ?, ?, ?, ?, ?, NULL, ?)`,
          [jobId, item.section_key, item.section_title, item.title, item.evidence || null, item.suggestion || null, i + 1]
        );
      }

      for (let i = 0; i < riskItems.length; i += 1) {
        const item = riskItems[i];
        await tx.run(
          `INSERT INTO tender_bid_generate_items
            (job_id, item_type, section_key, section_title, title, evidence_text, suggestion_text, risk_level, sort_order)
           VALUES (?, 'RISK', ?, ?, ?, ?, ?, ?, ?)`,
          [jobId, item.section_key, item.section_title, item.title, item.evidence || null, item.suggestion || null, trimText(item.risk_level || 'MEDIUM'), i + 1]
        );
      }

      for (let i = 0; i < rankedMatches.length; i += 1) {
        const item = rankedMatches[i];
        await tx.run(
          `INSERT INTO tender_bid_generate_matches
            (job_id, sample_id, score, reason_text, rank_no)
           VALUES (?, ?, ?, ?, ?)`,
          [jobId, Number(item.sample_id), Number(item.score || 0), trimText(item.reason).slice(0, 500) || null, i + 1]
        );
      }
    });

    const detail = await loadGenerateJobDetail(jobId);
    await logOperation({
      req,
      action: 'BID_ANALYZE_SUCCESS',
      entity: 'generate_job',
      entityId: jobId,
      message: `招标文件分析成功 ${sourceFileName}`,
      afterData: {
        summary: summaryPayload,
        model_id: model.id,
        model_name: model.name,
        bid_category: bidCategory,
        bid_category_label: bidCategoryLabel(bidCategory),
        stage_ai_task_log_ids: stageTaskLogIds,
      },
    });

    res.status(201).json({
      job: detail.job,
      section_summaries: parseMaybeJson(detail.job.section_summaries_json, []),
      table_summaries: tableSummaries,
      scoring_items: detail.items.filter((item) => item.item_type === 'SCORING'),
      risk_items: detail.items.filter((item) => item.item_type === 'RISK'),
      matches: detail.matches,
      final_json: finalJson,
      requirement_registry: requirementRegistry,
      clause_registry_v2: clauseRegistryV2,
      stage_outputs: stageOutputs,
      generated_artifacts: generatedArtifacts,
      warnings,
      model: { id: model.id, name: model.name },
    });
  } catch (err) {
    await run(
      `UPDATE tender_bid_generate_jobs
       SET status = 'FAILED', progress = 100, error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [trimText(err.message).slice(0, 2000) || '分析失败', jobId]
    );
    await logOperation({
      req,
      action: 'BID_ANALYZE_FAIL',
      entity: 'generate_job',
      entityId: jobId,
      message: `招标文件分析失败 ${sourceFileName}`,
      afterData: {
        error: trimText(err.message).slice(0, 2000),
      },
    });
    throw err;
  }
}));

const upsertDraftForGeneratedVersion = async (tx, { bid, versionId, sourcePath, user }) => {
  const draftCopyPath = await copyToManagedPath(sourcePath, DRAFT_ROOT, '.docx');
  const draftFileName = `${trimText(bid.title) || 'tender'}-draft.docx`;
  const existingDraft = await tx.get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [Number(bid.id)]);
  if (existingDraft) {
    await tx.run(
      `UPDATE tender_bid_drafts
       SET draft_file_path = ?, draft_file_name = ?, base_version_id = ?, updated_by_id = ?, updated_by_name = ?, last_saved_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [
        draftCopyPath,
        draftFileName,
        Number(versionId),
        Number(user?.id || 0) || null,
        trimText(user?.username) || null,
        Number(existingDraft.id),
      ]
    );
    return sanitizeDraftRow(await tx.get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [Number(existingDraft.id)]));
  }

  const inserted = await tx.run(
    `INSERT INTO tender_bid_drafts
      (bid_id, base_version_id, draft_file_path, draft_file_name, draft_ext, updated_by_id, updated_by_name, last_saved_at)
     VALUES (?, ?, ?, ?, 'docx', ?, ?, NOW())`,
    [
      Number(bid.id),
      Number(versionId),
      draftCopyPath,
      draftFileName,
      Number(user?.id || 0) || null,
      trimText(user?.username) || null,
    ]
  );
  return sanitizeDraftRow(await tx.get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [Number(inserted.insertId)]));
};

const createGeneratedDraftFromDetail = async ({ detail, req, model, existingBid = null }) => {
  const scoringItems = detail.items.filter((item) => item.item_type === 'SCORING');
  const riskItems = detail.items.filter((item) => item.item_type === 'RISK');
  const chosenSampleIds = toNumberIdList(req.body?.sample_ids, 6);
  const matchedSampleIds = chosenSampleIds.length
    ? chosenSampleIds
    : detail.matches.slice(0, 3).map((item) => Number(item.sample_id)).filter((id) => Number.isFinite(id) && id > 0);

  const sampleSections = [];
  for (const sampleId of matchedSampleIds) {
    const sections = await loadSampleSections(sampleId);
    for (const section of sections) {
      if (!trimText(section.section_text)) continue;
      if (sampleSections.some((item) => item.section_key === section.section_key)) continue;
      sampleSections.push(section);
    }
  }

  const sectionSummaries = parseMaybeJson(detail.job.section_summaries_json, []);
  const analysisSummary = parseMaybeJson(detail.job.analysis_summary_json, {});
  const tableSummaries = Array.isArray(analysisSummary?.table_summaries)
    ? analysisSummary.table_summaries
    : [];
  const stageOutputsRaw = isPlainObject(analysisSummary?.stage_outputs) ? analysisSummary.stage_outputs : {};
  const parseQualityGate = isPlainObject(stageOutputsRaw.parse_quality_gate)
    ? stageOutputsRaw.parse_quality_gate
    : null;
  const gateStatus = String(trimText(parseQualityGate?.status)).toUpperCase();
  const gateAllowGenerate = parseQualityGate?.allow_generate === undefined ? true : !!parseQualityGate.allow_generate;
  if (gateStatus === 'BLOCK' || !gateAllowGenerate) {
    const blocking = Array.isArray(parseQualityGate?.blocking_issues)
      ? parseQualityGate.blocking_issues.filter((item) => trimText(item) && trimText(item) !== '无')
      : [];
    throw appError(`解析门禁未通过，禁止生成初稿：${blocking.join('；') || '请先修复解析质量问题'}`, 400);
  }
  const scoreTableExtract = isPlainObject(stageOutputsRaw.score_table_extract)
    ? stageOutputsRaw.score_table_extract
    : { merged_total_count: 0 };
  const hasScoreTable = tableSummaries.some((item) =>
    trimText(item?.section_key).toUpperCase() === 'SCORE_TABLE'
    || trimText(item?.table_type).toUpperCase() === 'SCORE_TABLE'
  );
  const mergedScoreRows = Number(scoreTableExtract.merged_total_count || scoreTableExtract.merged_count || 0);
  if (hasScoreTable && mergedScoreRows <= 0) {
    throw appError('检测到评分表但未逐条提取到评分项，请先修正解析结果后再生成投标初稿', 400);
  }
  const stage1RiskClauses = normalizeStage1RiskClauses(stageOutputsRaw.stage1_risk_clauses || []);
  const bidCategory = normalizeBidCategory(detail?.job?.bid_category) || 'SERVICE';
  const instructionApplied = applyInstructionFormToFinalJson(
    analysisSummary?.final_json || {},
    req.body?.instruction_form,
    bidCategory
  );
  const finalJson = instructionApplied.finalJson;
  const instructionForm = instructionApplied.instructionForm;
  const generatedArtifacts = isPlainObject(analysisSummary?.generated_artifacts)
    ? analysisSummary.generated_artifacts
    : buildGeneratedArtifacts({
      finalJson,
      stage1RiskClauses,
      riskItems,
      scoringItems,
      bidCategory,
    });
  let requirementRegistry = await loadRequirementRegistryRows(Number(detail.job.id));
  if (!requirementRegistry.length) {
    requirementRegistry = buildRuntimeRequirementRegistry({ detail });
  }
  const clauseRegistryV2 = buildClauseRegistryV2({
    requirements: requirementRegistry,
  });
  const clauseRouteBuckets = buildClauseRouteBuckets({
    clauses: clauseRegistryV2,
  });
  const sectionList = sectionSummaries.map((item) => ({
    section_key: trimText(item.section_key),
    section_title: trimText(item.section_title),
    text: trimText(item.summary),
  }));
  const sourceFileName = trimText(detail.job.source_file_name) || '招标文件';

  const inferredTitle = trimText(req.body?.title)
    || trimText(existingBid?.title)
    || `${trimText(path.parse(sourceFileName).name)}投标文件`;
  const customerName = trimText(req.body?.customer_name)
    || trimText(existingBid?.customer_name)
    || '待完善客户';
  const projectName = trimText(req.body?.project_name)
    || trimText(existingBid?.project_name)
    || trimText(instructionForm.project_name)
    || trimText(path.parse(sourceFileName).name)
    || '待完善项目';
  const summary = trimText(req.body?.summary)
    || trimText(existingBid?.summary)
    || `由招标文件分析后自动生成，来源：${sourceFileName}`;
  const docTemplateId = Number(req.body?.doc_template_id || req.body?.template_id || 0);
  const selectedTemplate = await resolveDocTemplate(docTemplateId);

  const librarySnapshot = await collectOwnLibrarySnapshot(req.body?.library_snapshot);
  const bidNo = trimText(existingBid?.bid_no) || await nextBidNo();

  let chapters = buildDraftChaptersFromAnalysis({
    bidNo,
    title: inferredTitle,
    sourceFileName,
    sectionList,
    scoringItems,
    riskItems,
    sampleSections,
    librarySnapshot,
    generatedArtifacts,
    bidCategory,
    finalJson,
  });
  const baselineChapters = Array.isArray(chapters) ? chapters.map((item) => ({
    title: trimText(item?.title),
    content: Array.isArray(item?.content) ? item.content : toLines(item?.content || ''),
  })) : [];
  const draftChapterSchema = buildDraftChapterSchema({ bidCategory });

  const aiWarnings = [];
  try {
    const aiComposeInput = {
      bid_no: bidNo,
      title: inferredTitle,
      source_file_name: sourceFileName,
      bid_category: bidCategory,
      chapters,
      final_json: finalJson,
      scoring_items: scoringItems,
      risk_items: riskItems,
      table_summaries: tableSummaries,
      generated_artifacts: generatedArtifacts,
      instruction_form: instructionForm,
      draft_schema: draftChapterSchema,
    };
    const aiTask = await runAiTask({
      req,
      taskType: 'BID_COMPOSE_DRAFT',
      modelId: Number(model.id),
      inputText: JSON.stringify(aiComposeInput),
    });
    const aiParsed = aiTask?.parsed && typeof aiTask.parsed === 'object' ? aiTask.parsed : null;
    if (aiParsed && Array.isArray(aiParsed.chapters) && aiParsed.chapters.length) {
      chapters = aiParsed.chapters
        .slice(0, 20)
        .map((item, idx) => ({
          title: trimText(item?.title) || `章节${idx + 1}`,
          content: Array.isArray(item?.content)
            ? item.content.map((line) => trimText(line)).filter(Boolean)
            : toLines(item?.content || ''),
        }))
        .filter((item) => item.content.length > 0);
    } else {
      aiWarnings.push('模型未返回结构化章节，已使用规则骨架生成。');
    }
  } catch (err) {
    aiWarnings.push(`模型起草失败，已使用规则骨架生成：${trimText(err.message).slice(0, 120)}`);
  }

  const chapterSchemaResult = normalizeDraftChaptersToSchema({
    bidCategory,
    baselineChapters,
    aiChapters: chapters,
  });
  chapters = Array.isArray(chapterSchemaResult?.chapters) && chapterSchemaResult.chapters.length
    ? chapterSchemaResult.chapters
    : baselineChapters;
  if (!chapterSchemaResult?.validation?.valid) {
    aiWarnings.push(`章节结构未完全命中固定 schema，已按规则骨架兜底：${(chapterSchemaResult?.validation?.missing_required_keys || []).join(', ')}`);
  }

  const clauseRouteExecution = executeClauseRoutes({
    clauses: clauseRegistryV2,
    chapters,
  });
  chapters = Array.isArray(clauseRouteExecution?.chapters) && clauseRouteExecution.chapters.length
    ? clauseRouteExecution.chapters
    : chapters;
  const chapterQualitySummary = buildDraftChapterQualitySummary({
    bidCategory,
    chapters,
    validation: chapterSchemaResult?.validation || {},
  });
  const updatedAnalysisSummary = {
    ...analysisSummary,
    stage_outputs: {
      ...stageOutputsRaw,
      chapter_quality_summary: chapterQualitySummary,
    },
  };

  const generatedAtText = formatDateTime(new Date()) || '';
  const wordLayout = buildWordLayoutPlan({
    chapters,
    bidNo,
    projectName,
    projectTitle: inferredTitle,
    generatedAt: generatedAtText,
  });
  chapters = Array.isArray(wordLayout?.chapters) && wordLayout.chapters.length
    ? wordLayout.chapters
    : chapters;

  const paragraphs = buildParagraphsFromChapters(chapters);
  if (!paragraphs.length) {
    paragraphs.push('投标文件（自动生成初稿）', `标书编号：${bidNo}`, `标书标题：${inferredTitle}`, '请人工完善正文。');
  }
  const sectionLinks = buildSectionLinksFromClauseRegistry({
    clauses: clauseRegistryV2,
    chapters,
  });

  const projectCoreInfo = isPlainObject(finalJson?.project_core_info) ? finalJson.project_core_info : {};
  const companyInfoText = joinSummaryLines(buildCompanySummaryLines(librarySnapshot?.company || {}));
  const legalPersonInfoText = joinSummaryLines(buildPersonSummaryLines('法定代表人信息', librarySnapshot?.personnel?.legal || {}));
  const authorizedAgentInfoText = joinSummaryLines(buildPersonSummaryLines('授权委托人信息', librarySnapshot?.personnel?.agent || {}));
  const qualificationInfoText = joinSummaryLines(buildQualificationSummaryLines(librarySnapshot?.qualifications || []));
  const financeInfoText = joinSummaryLines(buildFinanceSummaryLines(librarySnapshot?.finance || []));
  const performanceInfoText = joinSummaryLines(buildPerformanceSummaryLines(librarySnapshot?.performance || []));
  const personnelInfoText = joinSummaryLines(buildPersonnelListSummaryLines(librarySnapshot?.personnel_list || []));
  const projectCoreInfoText = joinSummaryLines(buildProjectCoreSummaryLines(projectCoreInfo));
  const coverContent = pickChapterTexts(chapters, ['封面']);
  const tocContent = trimText(wordLayout?.toc_content) || pickChapterTexts(chapters, ['目录']);
  const businessVolumeContent = pickChapterTexts(chapters, ['商务']);
  const technicalVolumeContent = pickChapterTexts(chapters, ['技术', '服务方案', '采购需求']);
  const quotationVolumeContent = pickChapterTexts(chapters, ['报价', '偏离表']);
  const appendixIndexContent = trimText(wordLayout?.appendix_index_content) || pickChapterTexts(chapters, ['附录', '投标文件格式']);

  const outputPath = path.join(VERSION_ROOT, buildStoredFilename(`${inferredTitle}-auto.docx`, '.docx'));
  try {
    if (selectedTemplate?.storage_path) {
      await writeDocxWithTemplate({
        templatePath: selectedTemplate.storage_path,
        outputPath,
        chapters,
        tocLines: Array.isArray(wordLayout?.toc_lines) ? wordLayout.toc_lines : [],
        pageBreakTitles: Array.isArray(wordLayout?.page_break_titles) ? wordLayout.page_break_titles : [],
        payload: {
          bid_no: bidNo,
          project_title: inferredTitle,
          project_name: projectName,
          customer_name: customerName,
          source_file_name: sourceFileName,
          bid_category: bidCategoryLabel(bidCategory),
          project_code: trimText(instructionForm.project_code),
          package_no: trimText(instructionForm.package_no),
          budget: trimText(instructionForm.budget),
          buyer_name: trimText(instructionForm.buyer_name),
          agency_name: trimText(instructionForm.agency_name),
          project_domain: trimText(instructionForm.project_domain),
          project_overview: trimText(instructionForm.project_overview),
          project_core_info: projectCoreInfoText,
          company_info: companyInfoText,
          legal_person_info: legalPersonInfoText,
          authorized_agent_info: authorizedAgentInfoText,
          qualification_info: qualificationInfoText,
          finance_info: financeInfoText,
          performance_info: performanceInfoText,
          personnel_info: personnelInfoText,
          cover_content: coverContent,
          toc_content: tocContent,
          business_volume_content: businessVolumeContent,
          technical_volume_content: technicalVolumeContent,
          quotation_volume_content: quotationVolumeContent,
          appendix_index_content: appendixIndexContent,
          header_content: trimText(wordLayout?.header_text),
          footer_content: trimText(wordLayout?.footer_text),
          chapter_outline: trimText(wordLayout?.chapter_outline),
          generated_at: generatedAtText,
        },
      });
    } else {
      await writeSimpleDocx({
        outputPath,
        paragraphs,
        headerText: trimText(wordLayout?.header_text),
        footerText: trimText(wordLayout?.footer_text),
        tocLines: Array.isArray(wordLayout?.toc_lines) ? wordLayout.toc_lines : [],
        pageBreakTitles: Array.isArray(wordLayout?.page_break_titles) ? wordLayout.page_break_titles : [],
      });
    }
  } catch (err) {
    aiWarnings.push(`投标模板套版失败，已降级为基础文档：${trimText(err.message).slice(0, 120)}`);
    await writeSimpleDocx({
      outputPath,
      paragraphs,
      headerText: trimText(wordLayout?.header_text),
      footerText: trimText(wordLayout?.footer_text),
      tocLines: Array.isArray(wordLayout?.toc_lines) ? wordLayout.toc_lines : [],
      pageBreakTitles: Array.isArray(wordLayout?.page_break_titles) ? wordLayout.page_break_titles : [],
    });
  }
  const stat = await readFileStatSafe(outputPath);
  if (!stat?.isFile()) {
    await deleteFileSafe(outputPath);
    throw appError('投标初稿生成失败', 500);
  }

  const createResult = await transaction(async (tx) => {
    await tx.run(
      `UPDATE tender_bid_generate_jobs
       SET status = 'GENERATING', progress = 80, updated_at = NOW()
       WHERE id = ?`,
      [Number(detail.job.id)]
    );

    let bidId = Number(existingBid?.id || 0);
    let bidRow = existingBid ? await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [Number(existingBid.id)]) : null;
    if (!bidRow && existingBid) throw appError('目标标书不存在', 404);

    if (!bidRow) {
      const bidInfo = await tx.run(
        `INSERT INTO tender_bids
          (bid_no, title, customer_name, project_name, status, summary, created_by_id, created_by_name, updated_by_id, updated_by_name)
         VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
        [bidNo, inferredTitle, customerName, projectName, summary || null, Number(req.user.id), req.user.username, Number(req.user.id), req.user.username]
      );
      bidId = Number(bidInfo.insertId);
      bidRow = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
    } else {
      await tx.run(
        `UPDATE tender_bids
         SET title = ?, customer_name = ?, project_name = ?, summary = ?, status = 'DRAFT',
             updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          inferredTitle,
          customerName,
          projectName,
          summary || null,
          Number(req.user.id),
          req.user.username,
          bidId,
        ]
      );
      bidRow = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
    }

    const nextVersionNo = await getNextVersionNo(tx, bidId);
    const versionName = `${inferredTitle}-自动生成.docx`;
    const versionInfo = await tx.run(
      `INSERT INTO tender_bid_versions
        (bid_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type, created_by_id, created_by_name)
       VALUES (?, ?, 'auto_generate', 'docx', ?, ?, ?, ?, ?, ?)`,
      [
        bidId,
        nextVersionNo,
        outputPath,
        versionName,
        Number(stat.size || 0),
        guessMimeByExt('.docx'),
        Number(req.user.id),
        req.user.username,
      ]
    );
    const versionId = Number(versionInfo.insertId);
    const evidenceRegistry = buildEvidenceRows({
      bidId,
      librarySnapshot,
    });
    const draftSections = buildDraftSectionRows({
      bidId,
      versionId,
      chapters,
      sectionLinks,
    });

    await tx.run(
      `UPDATE tender_bids
       SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [versionId, Number(req.user.id), req.user.username, bidId]
    );

    let sourceAssetId = null;
    if (trimText(detail.job.source_storage_path)) {
      const sourceAssetInfo = await tx.run(
        `INSERT INTO tender_assets
          (bid_id, asset_type, original_file_name, mime_type, storage_path, file_size, status, uploaded_by_id, uploaded_by_name)
         VALUES (?, 'BIDDING_NOTICE', ?, ?, ?, ?, 'UPLOADED', ?, ?)`,
        [
          bidId,
          sourceFileName,
          trimText(detail.job.source_mime_type) || guessMimeByExt(detail.job.source_ext || '.docx'),
          trimText(detail.job.source_storage_path),
          Number(detail.job.source_file_size || 0),
          Number(req.user.id),
          req.user.username,
        ]
      );
      sourceAssetId = Number(sourceAssetInfo.insertId || 0) || null;
    }

    await persistEvidenceRegistry(tx, bidId, evidenceRegistry);
    await persistDraftSectionRegistry(tx, bidId, versionId, draftSections);
    const draftRow = await upsertDraftForGeneratedVersion(tx, {
      bid: bidRow,
      versionId,
      sourcePath: outputPath,
      user: req.user,
    });

    await tx.run(
      `UPDATE tender_bid_generate_jobs
       SET status = 'GENERATED', progress = 100, model_id = ?, model_name = ?, analysis_summary_json = ?, warning_text = ?, created_bid_id = ?, created_version_id = ?, created_draft_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        Number(model.id),
        trimText(model.name),
        JSON.stringify(updatedAnalysisSummary),
        aiWarnings.join('；') || detail.job.warning_text || null,
        bidId,
        versionId,
        Number(draftRow?.id || 0) || null,
        Number(detail.job.id),
      ]
    );

    return {
      bid: sanitizeBidRow(bidRow),
      bid_id: bidId,
      version_id: versionId,
      draft: draftRow,
      source_asset_id: sourceAssetId,
      evidence_registry: evidenceRegistry,
      draft_sections: draftSections,
      clause_registry_v2: clauseRegistryV2,
      clause_route_summary: Object.keys(clauseRouteBuckets).reduce((acc, key) => {
        acc[key] = Array.isArray(clauseRouteBuckets[key]) ? clauseRouteBuckets[key].length : 0;
        return acc;
      }, {}),
      clause_route_execution: {
        response_mode_counts: isPlainObject(clauseRouteExecution?.response_mode_counts)
          ? clauseRouteExecution.response_mode_counts
          : {},
        applied_changes: Number(clauseRouteExecution?.applied_changes || 0),
        applied_items: Array.isArray(clauseRouteExecution?.applied_items)
          ? clauseRouteExecution.applied_items
          : [],
      },
      chapter_schema_validation: chapterSchemaResult?.validation || null,
      chapter_quality_summary: chapterQualitySummary,
    };
  });

  const version = sanitizeVersionRow(await get('SELECT * FROM tender_bid_versions WHERE id = ? LIMIT 1', [createResult.version_id]));
  const job = sanitizeGenerateJobRow(await get('SELECT * FROM tender_bid_generate_jobs WHERE id = ? LIMIT 1', [Number(detail.job.id)]));

  await logOperation({
    req,
    action: existingBid ? 'BID_GENERATE_FROM_PARSE_WORKSPACE' : 'BID_GENERATE_FROM_ANALYSIS',
    entity: 'generate_job',
    entityId: Number(detail.job.id),
    message: existingBid
      ? `根据项目解析结果生成投标初稿 ${createResult.bid.bid_no}`
      : `根据分析任务生成投标初稿 ${createResult.bid.bid_no}`,
    afterData: {
      bid_id: createResult.bid.id,
      version_id: version.id,
      scoring_count: scoringItems.length,
      risk_count: riskItems.length,
      matched_sample_ids: matchedSampleIds,
      doc_template_id: Number(selectedTemplate?.id || 0) || null,
      doc_template_name: trimText(selectedTemplate?.template_name),
      clause_route_summary: createResult.clause_route_summary,
      clause_route_execution: createResult.clause_route_execution,
      chapter_schema_validation: createResult.chapter_schema_validation,
      chapter_quality_summary: createResult.chapter_quality_summary,
      warning_text: aiWarnings.join('；') || null,
      source_job_id: Number(detail.job.id),
    },
  });

  return {
    ok: true,
    job,
    bid: createResult.bid,
    version,
    draft: createResult.draft,
    evidence_registry: createResult.evidence_registry,
    draft_sections: createResult.draft_sections,
    clause_registry_v2: createResult.clause_registry_v2,
    clause_route_summary: createResult.clause_route_summary,
    clause_route_execution: createResult.clause_route_execution,
    chapter_schema_validation: createResult.chapter_schema_validation,
    chapter_quality_summary: createResult.chapter_quality_summary,
    warnings: aiWarnings,
  };
};

const parseBridgeRoleWeight = {
  MAIN: 0,
  CLARIFICATION: 1,
  ATTACHMENT: 2,
  SUPPLEMENT: 3,
};

const sortParseFilesForGenerateBridge = (files = []) =>
  [...(Array.isArray(files) ? files : [])]
    .filter((item) => item && item.status !== 'DELETED' && trimText(item.source_ext).toLowerCase() !== '.zip')
    .sort((a, b) => {
      const weightDiff = (parseBridgeRoleWeight[normalizeParseFileRole(a?.file_role)] ?? 99)
        - (parseBridgeRoleWeight[normalizeParseFileRole(b?.file_role)] ?? 99);
      if (weightDiff !== 0) return weightDiff;
      return Number(a?.id || 0) - Number(b?.id || 0);
    });

const pickParseBridgeSourceFile = (files = []) => {
  const sorted = sortParseFilesForGenerateBridge(files);
  return sorted[0] || null;
};

const inferSectionKeyFromParseTitle = (title = '') => {
  const text = trimText(title);
  if (!text) return 'ATTACHMENT';
  if (text.includes('投标人须知前附表')) return 'BIDDER_INSTRUCTION_TABLE';
  if (text.includes('投标人须知')) return 'BIDDER_INSTRUCTION';
  if (text.includes('技术参数')) return 'TECH_PARAM_TABLE';
  if (text.includes('评分表')) return 'SCORE_TABLE';
  if (text.includes('评标')) return 'SCORING_STANDARD';
  if (text.includes('采购需求')) return 'PROCUREMENT_REQUIREMENT';
  if (text.includes('合同')) return 'CONTRACT_TERMS';
  if (text.includes('附件')) return 'ATTACHMENT';
  return 'ATTACHMENT';
};

const buildFallbackSectionListFromParseClauses = (clauses = []) => {
  const groups = new Map();
  for (const clause of Array.isArray(clauses) ? clauses : []) {
    const sectionTitle = trimText(clause?.clause_title) || trimText(clause?.clause_type) || '附件';
    const sectionKey = inferSectionKeyFromParseTitle(sectionTitle);
    const current = groups.get(sectionKey) || {
      section_key: sectionKey,
      section_title: sectionTitle,
      text: '',
      summary: '',
    };
    current.text = [current.text, trimText(clause?.clause_text)].filter(Boolean).join('\n');
    current.summary = trimText(current.text).slice(0, 240);
    groups.set(sectionKey, current);
  }
  return Array.from(groups.values());
};

const buildParseBridgeAnalysisBundle = async ({ bid, parseDetail, parseFiles = [], bidCategory = 'SERVICE' }) => {
  const sortedFiles = sortParseFilesForGenerateBridge(parseFiles);
  const textBlocks = [];
  for (const file of sortedFiles) {
    const payload = await collectParseSourcePayload(file);
    const text = trimText(payload?.text);
    if (!text) continue;
    textBlocks.push(`【${normalizeParseFileRole(file.file_role)}】${trimText(file.display_name || file.original_file_name)}\n${text}`);
  }

  const sourceText = normalizeAnalysisText(
    textBlocks.join('\n\n') || (Array.isArray(parseDetail?.clauses) ? parseDetail.clauses.map((item) => trimText(item?.clause_text)).filter(Boolean).join('\n') : '')
  );
  const split = trimText(sourceText) ? splitTenderSections(sourceText) : { sectionList: [] };
  const sectionList = Array.isArray(split?.sectionList) && split.sectionList.length
    ? split.sectionList
    : buildFallbackSectionListFromParseClauses(parseDetail?.clauses || []);
  const sectionSummaries = sectionList.map((item) => ({
    section_key: trimText(item.section_key),
    section_title: trimText(item.section_title),
    summary: trimText(item.summary || item.text).slice(0, 500),
  }));
  const tableSummaries = buildTableSummaries({
    tables: (Array.isArray(parseDetail?.tables) ? parseDetail.tables : []).map((table, index) => ({
      table_index: Number(table?.table_index || index + 1),
      table_name: trimText(table?.table_name) || trimText(table?.source_sheet_name) || `表格${index + 1}`,
      source_sheet_name: trimText(table?.source_sheet_name),
      row_count: Number(table?.row_count || 0),
      column_count: Number(table?.column_count || 0),
      header: Array.isArray(table?.header) ? table.header : [],
      rows: Array.isArray(table?.rows) ? table.rows : [],
      summary: trimText(table?.summary_text),
      keywords: [
        trimText(table?.table_name),
        trimText(table?.source_sheet_name),
        ...(Array.isArray(table?.header) ? table.header.slice(0, 6).map((item) => trimText(item)) : []),
      ].filter(Boolean),
    })),
    sectionList,
  });
  const baseRule = buildRuleAnalyzeItems({ sectionList });
  let stage1RiskClauses = enrichStage1RiskClausesBySource(
    scanRiskClausesByKeywords(sectionList, bidCategory),
    sectionList
  );
  let stage3MissingItems = [];
  const requiredChapterScan = buildRequiredChapterScan(sectionList);

  const mergedFields = isPlainObject(parseDetail?.job?.merged_fields) ? parseDetail.job.merged_fields : {};
  let finalJson = normalizeFinalAnalyzeJson({
    project_core_info: {
      project_type: bidCategoryLabel(bidCategory),
      project_full_name: firstNonEmpty(mergedFields.project_full_name, mergedFields.project_name, bid.project_name, bid.title),
      project_name: firstNonEmpty(mergedFields.project_name, bid.project_name, bid.title),
      project_code: firstNonEmpty(mergedFields.project_code, bid.bid_no),
      package_no: firstNonEmpty(mergedFields.package_no),
      project_budget: firstNonEmpty(mergedFields.project_budget, mergedFields.budget),
      buyer_full_name: firstNonEmpty(mergedFields.buyer_name, bid.customer_name),
      agency_full_name: firstNonEmpty(mergedFields.agency_name),
      project_domain: firstNonEmpty(mergedFields.project_domain),
      project_overview: firstNonEmpty(mergedFields.project_overview, sectionSummaries[0]?.summary),
      bid_deadline: firstNonEmpty(mergedFields.bid_deadline),
    },
  }, bidCategory);

  const scoreMergeResult = mergeScoreItemsIntoFinalJson({
    finalJson,
    tableSummaries,
    ruleScoringItems: baseRule.scoring_items,
    bidCategory,
  });
  finalJson = scoreMergeResult.final_json;

  let productParamMergeResult = {
    table_param_extracted_count: 0,
    table_param_merged_count: 0,
  };
  if (normalizeBidCategory(bidCategory) === 'PRODUCT') {
    productParamMergeResult = mergeProductParametersIntoFinalJson({
      finalJson,
      tableSummaries,
    });
    finalJson = productParamMergeResult.final_json;
  }

  const ruleCoverageSummary = buildRuleCoverageSummary({
    sectionList,
    bidCategory,
    stage1RiskClauses,
    scoreExtract: {
      merged_count: scoreMergeResult.merged_count,
      merged_total_count: scoreMergeResult.merged_total_count,
    },
  });
  if (Array.isArray(ruleCoverageSummary.missing_items) && ruleCoverageSummary.missing_items.length > 0) {
    stage3MissingItems = enrichStage3MissingItemsBySource(ruleCoverageSummary.missing_items, sectionList);
    finalJson = mergeAnalyzeFinalJson({
      stage2FinalJson: finalJson,
      stage1RiskClauses,
      stage3MissingItems,
      bidCategory,
    });
  }

  const fallbackFillResult = enrichAnalyzeFinalJsonByRules({
    finalJson,
    sectionList,
    bidCategory,
  });
  finalJson = fallbackFillResult.final_json;

  let scoringItems = buildScoringItemsFromFinalJson(finalJson);
  let riskItems = buildRiskItemsFromFinalJson({ finalJson, stage1RiskClauses, bidCategory });
  if (!scoringItems.length) scoringItems = baseRule.scoring_items;
  if (!riskItems.length) riskItems = baseRule.risk_items;
  scoringItems = enrichGenerateItemsBySource(scoringItems, sectionList);
  riskItems = enrichGenerateItemsBySource(riskItems, sectionList);

  const warnings = [];
  if (!tableSummaries.length) warnings.push('解析工作台未识别到结构化表格，将按正文条款继续生成。');
  if (Number(fallbackFillResult.filled_count || 0) > 0) {
    warnings.push(`规则引擎补全商务/技术条款 ${fallbackFillResult.filled_count} 项。`);
  }

  const generatedArtifacts = buildGeneratedArtifacts({
    finalJson,
    stage1RiskClauses,
    riskItems,
    scoringItems,
    bidCategory,
  });
  const qualityGate = buildAnalyzeQualityGate({
    sourceText,
    requiredChapterScan,
    tableSummaries,
    stage1RiskClauses,
    scoreExtract: {
      merged_count: scoreMergeResult.merged_count,
      merged_total_count: scoreMergeResult.merged_total_count,
    },
    productParamExtract: productParamMergeResult,
    bidCategory,
    preflightOnly: false,
  });
  for (const item of qualityGate.warning_issues || []) {
    if (item && item !== '无') warnings.push(`门禁提醒：${item}`);
  }

  const evidenceRegistry = {
    stage1_risk_clauses: stage1RiskClauses.map((item) => ({
      evidence_id: item.evidence_id,
      clause_type: item.clause_type,
      clause_content: item.clause_content,
      source_reference: item.source_reference,
    })),
    stage3_missing_items: stage3MissingItems.map((item) => ({
      item_type: item.item_type,
      missing_content: item.missing_content,
      source_reference: item.source_reference,
    })),
    scoring_items: scoringItems.map((item, idx) => ({
      item_no: idx + 1,
      title: item.title,
      source_reference: item.source_reference,
    })),
    risk_items: riskItems.map((item, idx) => ({
      item_no: idx + 1,
      title: item.title,
      source_reference: item.source_reference,
    })),
  };

  const analysisSummary = {
    ...composeAnalysisSummary({
      sections: sectionSummaries,
      tables: tableSummaries,
      scoringItems,
      riskItems,
      warnings,
    }),
    bid_category: bidCategory,
    bid_category_label: bidCategoryLabel(bidCategory),
    stage_outputs: {
      stage1_risk_clauses: stage1RiskClauses,
      stage3_missing_items: stage3MissingItems,
      required_chapter_scan: requiredChapterScan,
      parse_quality_gate: qualityGate,
      score_table_extract: {
        table_extracted_count: Number(tableSummaries.length || 0),
        fallback_extracted_count: 0,
        merged_count: Number(scoreMergeResult.merged_count || 0),
        fallback_merged_count: 0,
        merged_total_count: Number(scoreMergeResult.merged_total_count || 0),
      },
      product_param_extract: productParamMergeResult,
      rule_scan_summary: ruleCoverageSummary,
      evidence_registry: evidenceRegistry,
    },
    table_summaries: tableSummaries,
    final_json: finalJson,
    generated_artifacts: generatedArtifacts,
    candidate_samples: [],
  };

  return {
    sectionSummaries,
    analysisSummary,
    scoringItems,
    riskItems,
    stage1RiskClauses,
    warnings,
  };
};

const createGenerateJobFromParseBridge = async ({ bid, parseDetail, parseFiles, req, model, bidCategory }) => {
  const sourceFile = pickParseBridgeSourceFile(parseFiles);
  const sourceFileName = trimText(sourceFile?.display_name || sourceFile?.original_file_name)
    || `${trimText(bid.project_name || bid.title) || '项目解析结果'}.docx`;
  const sourceStoragePath = trimText(sourceFile?.storage_path) || path.join(UPLOAD_ROOT, 'parse-bridge-placeholder.docx');
  const sourceExt = trimText(sourceFile?.source_ext).toLowerCase() || '.docx';
  const sourceMimeType = trimText(sourceFile?.mime_type) || guessMimeByExt(sourceExt || '.docx');
  const sourceFileSize = Number(sourceFile?.file_size || 0);

  const inserted = await run(
    `INSERT INTO tender_bid_generate_jobs
      (source_file_name, source_storage_path, source_ext, source_mime_type, source_file_size, model_id, model_name, bid_category, status, progress, operator_id, operator_name, request_ip, created_bid_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ANALYZING', 10, ?, ?, ?, ?)`,
    [
      sourceFileName,
      sourceStoragePath,
      sourceExt || '.docx',
      sourceMimeType,
      sourceFileSize,
      Number(model.id),
      trimText(model.name),
      bidCategory,
      Number(req.user.id || 0) || null,
      trimText(req.user.username) || null,
      trimText(getClientIp(req)),
      Number(bid.id),
    ]
  );
  const jobId = Number(inserted.insertId);

  try {
    const bundle = await buildParseBridgeAnalysisBundle({
      bid,
      parseDetail,
      parseFiles,
      bidCategory,
    });
    const requirementRegistry = buildRequirementRows({
      jobId,
      bidCategory,
      finalJson: normalizeFinalAnalyzeJson(bundle.analysisSummary?.final_json || {}, bidCategory),
      scoringItems: bundle.scoringItems,
      stage1RiskClauses: bundle.stage1RiskClauses,
      tableSummaries: Array.isArray(bundle.analysisSummary?.table_summaries) ? bundle.analysisSummary.table_summaries : [],
    });
    const clauseRegistryV2 = buildClauseRegistryV2({
      requirements: requirementRegistry,
    });
    bundle.analysisSummary.stage_outputs = {
      ...(isPlainObject(bundle.analysisSummary.stage_outputs) ? bundle.analysisSummary.stage_outputs : {}),
      clause_registry_v2: clauseRegistryV2,
    };
    bundle.analysisSummary.clause_registry_v2 = clauseRegistryV2;

    await transaction(async (tx) => {
      await tx.run(
        `UPDATE tender_bid_generate_jobs
         SET status = 'ANALYZED', progress = 60, section_summaries_json = ?, analysis_summary_json = ?, warning_text = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          JSON.stringify(bundle.sectionSummaries),
          JSON.stringify(bundle.analysisSummary),
          bundle.warnings.join('；') || null,
          jobId,
        ]
      );
      await tx.run('DELETE FROM tender_bid_generate_items WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM tender_bid_generate_matches WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM tender_requirement_registry WHERE job_id = ?', [jobId]);

      for (let i = 0; i < bundle.scoringItems.length; i += 1) {
        const item = bundle.scoringItems[i];
        await tx.run(
          `INSERT INTO tender_bid_generate_items
            (job_id, item_type, section_key, section_title, title, evidence_text, suggestion_text, risk_level, sort_order)
           VALUES (?, 'SCORING', ?, ?, ?, ?, ?, NULL, ?)`,
          [jobId, item.section_key, item.section_title, item.title, item.evidence || null, item.suggestion || null, i + 1]
        );
      }
      for (let i = 0; i < bundle.riskItems.length; i += 1) {
        const item = bundle.riskItems[i];
        await tx.run(
          `INSERT INTO tender_bid_generate_items
            (job_id, item_type, section_key, section_title, title, evidence_text, suggestion_text, risk_level, sort_order)
           VALUES (?, 'RISK', ?, ?, ?, ?, ?, ?, ?)`,
          [jobId, item.section_key, item.section_title, item.title, item.evidence || null, item.suggestion || null, trimText(item.risk_level || 'MEDIUM'), i + 1]
        );
      }
      await persistRequirementRegistry(tx, jobId, requirementRegistry);
    });

    return loadGenerateJobDetail(jobId);
  } catch (err) {
    await run(
      `UPDATE tender_bid_generate_jobs
       SET status = 'FAILED', progress = 100, error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [trimText(err.message).slice(0, 2000) || '项目解析桥接生成失败', jobId]
    );
    throw err;
  }
};

app.post('/api/tender/bids/generate/jobs/:id/create', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) throw appError('任务ID无效', 400);

  const detail = await loadGenerateJobDetail(jobId);
  if (!detail) throw appError('分析任务不存在', 404);
  if (!['ANALYZED', 'GENERATED'].includes(String(detail.job.status || '').toUpperCase())) {
    throw appError('当前任务状态不允许生成，请先完成分析', 400);
  }

  const model = await resolveModel(Number(req.body?.model_id || detail.job.model_id || 0));
  const result = await createGeneratedDraftFromDetail({
    detail,
    req,
    model,
  });
  res.status(201).json(result);
}));

app.post('/api/tender/bids/:id/generate/from-parse', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const latestParseJob = await loadLatestParseJobRow(bidId);
  if (!latestParseJob || Number(latestParseJob.id || 0) <= 0) {
    throw appError('请先完成项目解析后再生成初稿', 409);
  }
  const parseDetail = await loadParseJobDetail(Number(latestParseJob.id), { bidId });
  if (!parseDetail || (!Array.isArray(parseDetail.clauses) || !parseDetail.clauses.length) && (!Array.isArray(parseDetail.tables) || !parseDetail.tables.length)) {
    throw appError('当前项目缺少可用于生成的解析结果', 409);
  }

  const parseFiles = await loadParseFilesByBidId(bidId, { includeDeleted: false });
  const bidCategory = normalizeBidCategory(req.body?.bid_category || bid.bid_category) || 'SERVICE';
  const model = await resolveModel(Number(req.body?.model_id || 0));
  const detail = await createGenerateJobFromParseBridge({
    bid,
    parseDetail,
    parseFiles,
    req,
    model,
    bidCategory,
  });
  const result = await createGeneratedDraftFromDetail({
    detail,
    req,
    model,
    existingBid: bid,
  });
  res.status(201).json(result);
}));

app.post('/api/tender/bids/auto-generate', requirePermission('tender:write'), uploadTenderSourceFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.path) throw appError('请上传招标文件', 400);

  const bundleId = Number(req.body?.bundle_id);
  if (!Number.isFinite(bundleId) || bundleId <= 0) throw appError('bundle_id无效', 400);

  const sourceExt = normalizeBidUploadExt(file.originalname || '') || path.extname(file.path).toLowerCase() || '.docx';
  const sourceFileName = fixMojibakeText(trimText(file.originalname) || path.basename(file.path));
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
  const title = clipText(fixMojibakeText(trimText(req.body?.title) || `${inferredTitleSeed}投标文件`), 200);
  const customerName = clipText(fixMojibakeText(req.body?.customer_name), 120) || '待完善客户';
  const projectName = clipText(fixMojibakeText(req.body?.project_name), 120) || inferredTitleSeed;
  const summaryInput = fixMojibakeText(trimText(req.body?.summary));
  const summary = summaryInput || `由招标文件自动生成，来源文件：${sourceFileName}`;

  const { bundle, filledFieldValues, snippetValues } = await resolveBundlePayloadData({
    bundleId,
    requireActive: true,
  });

  const bidNo = await nextBidNo();
  const generatedDocPath = path.join(VERSION_ROOT, buildStoredFilename(`${title}-auto.docx`, '.docx'));
  const generatedDocName = `${title}-自动生成.docx`;
  const nowText = formatDateTime(new Date()) || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const bundleLayout = buildWordLayoutPlan({
    chapters: [],
    bidNo,
    projectName,
    projectTitle: title,
    generatedAt: nowText,
  });

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

  await writeSimpleDocx({
    outputPath: generatedDocPath,
    paragraphs,
    headerText: trimText(bundleLayout?.header_text),
    footerText: trimText(bundleLayout?.footer_text),
    pageBreakTitles: Array.isArray(bundleLayout?.page_break_titles) ? bundleLayout.page_break_titles : [],
  });
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
  const version = sanitizeVersionRow(await get('SELECT * FROM tender_bid_versions WHERE id = ? LIMIT 1', [created.versionId]));
  const sourceAsset = sanitizeAssetRow(await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [created.assetId]));
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
  const bid = await ensureBidExists(id, { user: req.user });
  const [bidWithMembers] = await withBidMembers([bid]);
  const currentVersion = await getCurrentVersion(bid);
  const draft = sanitizeDraftRow(await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [id]));
  res.json({ ...bidWithMembers, currentVersion, draft });
}));

app.get('/api/tender/bids/:id/kb/workspace', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });
  const payload = await loadBidKbWorkspace({ bid, user: req.user });
  res.json(payload);
}));

app.post('/api/tender/bids/:id/kb/ingest', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });
  const overrides = isPlainObject(req.body) ? req.body : {};

  const ingestResult = await runBidKbIngest({
    bid,
    user: req.user,
    overrides,
  });
  const payload = await loadBidKbWorkspace({
    bid: await ensureBidExists(bidId, { user: req.user }),
    user: req.user,
  });

  await logOperation({
    req,
    action: 'KB_BID_INGEST',
    entity: 'bid',
    entityId: bidId,
    message: `执行知识库沉淀 ${bid.bid_no}`,
    afterData: {
      job_id: ingestResult.job_id,
      kb_project_id: ingestResult.kb_project_id,
      summary: ingestResult.summary,
    },
  });

  res.json(payload);
}));

app.get('/api/tender/bids/:id/draft/workspace', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });
  const currentVersion = await getCurrentVersion(bid);
  const draft = await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [bidId]);
  const payload = await buildDraftWorkspacePayload({
    bid,
    currentVersion,
    draft,
  });
  res.json(payload);
}));

app.put('/api/tender/bids/:id/draft/sections', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Array.isArray(req.body?.sections)) throw appError('sections 必须为数组', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const currentVersion = await getCurrentVersion(bid);
  const draft = await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [bidId]);
  const versionId = resolveDraftWorkspaceVersionId({ bid, currentVersion, draft });
  if (!versionId) throw appError('当前项目尚无可保存的初稿版本', 409);

  const sections = normalizeDraftSectionRows(req.body.sections).map((item, index) => ({
    section_title: item.section_title || '文档正文',
    paragraph_no: Number(item.paragraph_no || index + 1) || index + 1,
    paragraph_text: item.paragraph_text,
    requirement_ids_json: JSON.stringify(Array.isArray(item.requirement_ids) ? item.requirement_ids : []),
    evidence_ids_json: JSON.stringify(Array.isArray(item.evidence_ids) ? item.evidence_ids : []),
    score_item_ids_json: JSON.stringify(Array.isArray(item.score_item_ids) ? item.score_item_ids : []),
  }));

  await transaction(async (tx) => {
    await persistDraftSectionRegistry(tx, bidId, versionId, sections);
  });

  await logOperation({
    req,
    action: 'DRAFT_SECTION_SAVE',
    entity: 'bid',
    entityId: bidId,
    message: `保存结构化章节稿 ${bid.bid_no}`,
    afterData: {
      version_id: versionId,
      section_count: sections.length,
    },
  });

  res.json({
    ok: true,
    bid_id: bidId,
    version_id: versionId,
    sections: normalizeDraftSectionRows(sections),
  });
}));

app.put('/api/tender/bids/:id/draft/artifacts', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!isPlainObject(req.body?.artifacts)) throw appError('artifacts 必须为对象', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const currentVersion = await getCurrentVersion(bid);
  const draft = await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [bidId]);
  const versionId = resolveDraftWorkspaceVersionId({ bid, currentVersion, draft });
  if (!versionId) throw appError('当前项目尚无可保存的初稿版本', 409);

  const artifactRows = buildDraftArtifactRowsForSave({
    bidId,
    versionId,
    artifacts: req.body.artifacts,
  });

  await transaction(async (tx) => {
    await persistDraftArtifactRows(tx, {
      bidId,
      versionId,
      rows: artifactRows,
      user: req.user,
    });
  });

  await logOperation({
    req,
    action: 'DRAFT_ARTIFACT_SAVE',
    entity: 'bid',
    entityId: bidId,
    message: `保存结构化偏离/应答表 ${bid.bid_no}`,
    afterData: {
      version_id: versionId,
      row_count: artifactRows.length,
    },
  });

  res.json({
    ok: true,
    bid_id: bidId,
    version_id: versionId,
    artifacts: buildDraftArtifactCollections({
      persistedRows: artifactRows,
      generatedArtifacts: {},
    }),
  });
}));

app.get('/api/tender/bids/:id/members', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const memberMap = await loadBidMembersMap([bidId]);
  res.json({
    bid_id: bidId,
    members: memberMap.get(bidId) || [],
  });
}));

app.put('/api/tender/bids/:id/members', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Array.isArray(req.body?.members)) throw appError('members 必须为数组', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const beforeMembers = (await loadBidMembersMap([bidId])).get(bidId) || [];

  await transaction(async (tx) => {
    const row = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
    if (!row) throw appError('标书不存在', 404);
    await ensureBidMembers({ bid: row, members: req.body.members, req, tx });
  });

  const members = (await loadBidMembersMap([bidId])).get(bidId) || [];
  await logOperation({
    req,
    action: 'BID_MEMBER_ASSIGN',
    entity: 'bid',
    entityId: bidId,
    message: `更新标书成员分派 ${bid.bid_no}`,
    beforeData: { members: beforeMembers },
    afterData: { members },
  });

  res.json({
    bid_id: bidId,
    members,
  });
}));

app.get('/api/tender/bids/:id/parse/workspace', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });
  const workspace = await loadBidParseWorkspace(bidId);
  res.json({
    bid,
    ...workspace,
  });
}));

app.post('/api/tender/bids/:id/parse/files', requirePermission('tender:write'), uploadTenderParseFiles, asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });

  const fileRole = normalizeParseFileRole(req.body?.file_role || req.body?.role || req.body?.source_role);
  const incomingFiles = Array.isArray(req.files) ? req.files : [];
  if (!incomingFiles.length) throw appError('请至少上传一个文件', 400);

  const createdIds = [];
  const warnings = [];
  for (const file of incomingFiles) {
    const sourceExt = normalizeParseUploadExt(file.originalname || file.path);
    if (!sourceExt) throw uploadValidationError('仅支持上传 doc/docx/pdf/xls/xlsx/zip');
    const sourceFileName = fixMojibakeText(trimText(file.originalname) || path.basename(file.path));

    let sheetManifest = [];
    let selectedSheetNames = [];
    let parseSummary = {};

    if (['.xlsx', '.xls'].includes(sourceExt)) {
      const workbook = await loadSpreadsheetWorkbookFromStoredFile({
        sourcePath: file.path,
        sourceExt,
        sourceName: sourceFileName,
      });
      sheetManifest = workbook.sheet_manifest || [];
      selectedSheetNames = workbook.selected_sheet_names || [];
      parseSummary = buildParseFilePreviewSummary(workbook);
    }

    const inserted = await run(
      `INSERT INTO tender_bid_parse_files
        (bid_id, parse_job_id, parent_file_id, root_file_id, file_role, file_kind, status, source_depth, relative_path,
         original_file_name, display_name, source_ext, source_mime_type, storage_path, file_size,
         sheet_manifest_json, selected_sheets_json, parse_summary_json, uploaded_by_id, uploaded_by_name)
       VALUES (?, NULL, NULL, NULL, ?, 'UPLOAD', ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bidId,
        fileRole,
        sourceExt === '.zip' ? 'EXTRACTED' : 'UPLOADED',
        sourceFileName,
        sourceFileName,
        sourceExt,
        trimText(file.mimetype) || guessMimeByExt(sourceExt),
        file.path,
        Number(file.size || 0),
        JSON.stringify(sheetManifest),
        JSON.stringify(selectedSheetNames),
        JSON.stringify(parseSummary),
        Number(req.user.id || 0) || null,
        trimText(req.user.username) || null,
      ]
    );
    const rootFileId = Number(inserted.insertId);
    createdIds.push(rootFileId);
    await run('UPDATE tender_bid_parse_files SET root_file_id = ? WHERE id = ?', [rootFileId, rootFileId]);

    if (sourceExt === '.zip') {
      const zipBuffer = await fs.promises.readFile(file.path);
      const extracted = await extractArchiveDocumentsFromBuffer(zipBuffer, { sourceName: sourceFileName });
      warnings.push(...(Array.isArray(extracted.skipped) ? extracted.skipped : []).map((item) => ({
        file_name: sourceFileName,
        entry_name: item.entryName,
        reason: item.reason,
      })));

      for (const entry of extracted.files || []) {
        const childSourceName = path.basename(entry.entryName);
        const childStoragePath = path.join(PARSE_ROOT, buildStoredFilename(childSourceName, entry.ext));
        await fs.promises.writeFile(childStoragePath, entry.buffer);

        let childManifest = [];
        let childSelectedSheetNames = [];
        let childSummary = {};
        if (['.xlsx', '.xls'].includes(entry.ext)) {
          const workbook = await loadSpreadsheetWorkbookFromBuffer({
            buffer: entry.buffer,
            sourceExt: entry.ext,
            sourceName: childSourceName,
          });
          childManifest = workbook.sheet_manifest || [];
          childSelectedSheetNames = workbook.selected_sheet_names || [];
          childSummary = buildParseFilePreviewSummary(workbook);
        }

        const childInserted = await run(
          `INSERT INTO tender_bid_parse_files
            (bid_id, parse_job_id, parent_file_id, root_file_id, file_role, file_kind, status, source_depth, relative_path,
             original_file_name, display_name, source_ext, source_mime_type, storage_path, file_size,
             sheet_manifest_json, selected_sheets_json, parse_summary_json, uploaded_by_id, uploaded_by_name)
           VALUES (?, NULL, ?, ?, ?, 'ARCHIVE_ENTRY', 'UPLOADED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bidId,
            rootFileId,
            rootFileId,
            fileRole,
            Math.max(1, Number(entry.depth || 0) + 1),
            trimText(entry.entryName) || childSourceName,
            trimText(entry.entryName) || childSourceName,
            childSourceName,
            entry.ext,
            guessMimeByExt(entry.ext),
            childStoragePath,
            Number(entry.buffer?.length || 0),
            JSON.stringify(childManifest),
            JSON.stringify(childSelectedSheetNames),
            JSON.stringify(childSummary),
            Number(req.user.id || 0) || null,
            trimText(req.user.username) || null,
          ]
        );
        createdIds.push(Number(childInserted.insertId));
      }

      await run(
        `UPDATE tender_bid_parse_files
         SET parse_summary_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify({
          extracted_count: Number(extracted.files?.length || 0),
          skipped_count: Number(extracted.skipped?.length || 0),
        }), rootFileId]
      );
    }
  }

  await refreshBidStatusAfterParseUpload({ bidId, user: req.user });
  const workspace = await loadBidParseWorkspace(bidId);
  res.status(201).json({
    bid_id: bidId,
    items: workspace.files.filter((item) => createdIds.includes(Number(item.id))),
    warnings,
    workspace,
  });
}));

app.delete('/api/tender/bids/:id/parse/files/:fileId', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const fileId = Number(req.params.fileId);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(fileId) || fileId <= 0) throw appError('文件ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  await ensureParseFileExists({ bidId, fileId });

  const rows = await query(
    `SELECT *
     FROM tender_bid_parse_files
     WHERE bid_id = ?
       AND status <> 'DELETED'
       AND (id = ? OR parent_file_id = ? OR root_file_id = ?)
     ORDER BY source_depth DESC, id DESC`,
    [bidId, fileId, fileId, fileId]
  );
  const targetRows = rows.map((row) => sanitizeParseFileRow(row));
  const targetIds = targetRows.map((item) => Number(item.id)).filter((item) => Number.isFinite(item) && item > 0);
  const clauseRows = targetIds.length
    ? await query(
      `SELECT id
       FROM tender_bid_parse_clauses
       WHERE bid_id = ? AND source_file_id IN (${targetIds.map(() => '?').join(',')})`,
      [bidId, ...targetIds]
    )
    : [];
  const clauseIds = clauseRows.map((item) => Number(item.id)).filter((item) => Number.isFinite(item) && item > 0);

  await transaction(async (tx) => {
    if (clauseIds.length) {
      await tx.run(
        `DELETE FROM tender_bid_parse_matches
         WHERE bid_id = ? AND clause_id IN (${clauseIds.map(() => '?').join(',')})`,
        [bidId, ...clauseIds]
      );
    }
    if (targetIds.length) {
      await tx.run(
        `DELETE FROM tender_bid_parse_clauses
         WHERE bid_id = ? AND source_file_id IN (${targetIds.map(() => '?').join(',')})`,
        [bidId, ...targetIds]
      );
      await tx.run(
        `DELETE FROM tender_bid_parse_tables
         WHERE bid_id = ? AND source_file_id IN (${targetIds.map(() => '?').join(',')})`,
        [bidId, ...targetIds]
      );
      await tx.run(
        `UPDATE tender_bid_parse_files
         SET status = 'DELETED', updated_at = NOW()
         WHERE bid_id = ? AND id IN (${targetIds.map(() => '?').join(',')})`,
        [bidId, ...targetIds]
      );
    }
  });

  const filePathSet = new Set(targetRows.map((item) => trimText(item.storage_path)).filter(Boolean));
  for (const filePath of filePathSet) {
    await deleteFileSafe(filePath);
  }

  const workspace = await loadBidParseWorkspace(bidId);
  res.json({
    ok: true,
    bid_id: bidId,
    deleted_ids: targetIds,
    workspace,
  });
}));

app.post('/api/tender/bids/:id/parse/files/:fileId/sheets/select', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const fileId = Number(req.params.fileId);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(fileId) || fileId <= 0) throw appError('文件ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const file = await ensureParseFileExists({ bidId, fileId });
  if (!['.xlsx', '.xls'].includes(trimText(file.source_ext).toLowerCase())) {
    throw appError('当前文件不是 Excel，不能选择 sheet', 400);
  }

  let sheetManifest = Array.isArray(file.sheet_manifest) ? file.sheet_manifest : [];
  if (!sheetManifest.length) {
    const workbook = await loadSpreadsheetWorkbookFromStoredFile({
      sourcePath: file.storage_path,
      sourceExt: file.source_ext,
      sourceName: file.display_name,
    });
    sheetManifest = workbook.sheet_manifest || [];
  }
  const selected = resolveSelectedSheetNames(
    sheetManifest,
    req.body?.selected_sheet_names || req.body?.sheet_names || req.body?.sheets || []
  );
  if (sheetManifest.length && !selected.length) {
    throw appError('请至少勾选一个 sheet', 400);
  }
  const workbook = await loadSpreadsheetWorkbookFromStoredFile({
    sourcePath: file.storage_path,
    sourceExt: file.source_ext,
    sourceName: file.display_name,
    selectedSheetNames: selected,
  });
  await run(
    `UPDATE tender_bid_parse_files
     SET sheet_manifest_json = ?, selected_sheets_json = ?, parse_summary_json = ?, updated_at = NOW()
     WHERE id = ? AND bid_id = ?`,
    [
      JSON.stringify(sheetManifest),
      JSON.stringify(selected),
      JSON.stringify(buildParseFilePreviewSummary(workbook)),
      fileId,
      bidId,
    ]
  );

  res.json({
    bid_id: bidId,
    file: sanitizeParseFileRow(await get('SELECT * FROM tender_bid_parse_files WHERE id = ? LIMIT 1', [fileId])),
  });
}));

app.post('/api/tender/bids/:id/parse/start', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const parseScope = normalizeParseScope(req.body?.parse_scope || req.body?.scope);

  const files = await loadParseFilesByBidId(bidId);
  const parseableFiles = files.filter((item) => item.status !== 'DELETED' && trimText(item.source_ext).toLowerCase() !== '.zip');
  if (!parseableFiles.length) throw appError('请先上传招标文件、澄清文件或附件', 400);

  const created = await run(
    `INSERT INTO tender_bid_parse_jobs
      (bid_id, parse_scope, status, progress, file_count, operator_id, operator_name)
     VALUES (?, ?, 'RUNNING', 10, ?, ?, ?)`,
    [bidId, parseScope, parseableFiles.length, Number(req.user.id || 0) || null, trimText(req.user.username) || null]
  );
  const jobId = Number(created.insertId);

  try {
    const mergedSources = [];
    const tableRows = [];
    const clauseRows = [];
    const warnings = [];
    let tableSort = 1;
    let clauseSort = 1;

    for (const file of parseableFiles) {
      const payload = await collectParseSourcePayload(file);
      const scopedTables = filterTablesByParseScope(parseScope, payload.tables);
      const scopedClauses = filterClausesByParseScope(parseScope, buildParseClauses({
        text: payload.text,
        tables: scopedTables,
        fileRole: file.file_role,
      }));

      if (!trimText(payload.text) && !scopedTables.length) {
        warnings.push(`${trimText(file.display_name || file.original_file_name)} 未提取到可解析内容`);
      }

      mergedSources.push({
        file_role: file.file_role,
        fields: payload.fields,
      });

      for (const table of scopedTables) {
        tableRows.push({
          bid_id: bidId,
          parse_job_id: jobId,
          source_file_id: Number(file.id),
          table_name: trimText(table.table_name) || trimText(file.display_name),
          source_sheet_name: trimText(table.source_sheet_name) || null,
          row_count: Number(table.row_count || 0),
          column_count: Number(table.column_count || 0),
          summary_text: trimText(table.summary) || null,
          header_json: JSON.stringify(Array.isArray(table.header) ? table.header : []),
          rows_json: JSON.stringify(Array.isArray(table.rows) ? table.rows : []),
          source_role: file.file_role,
          sort_order: tableSort,
        });
        tableSort += 1;
      }

      for (const clause of scopedClauses) {
        clauseRows.push({
          bid_id: bidId,
          parse_job_id: jobId,
          source_file_id: Number(file.id),
          clause_code: `PW-${jobId}-${String(clauseSort).padStart(4, '0')}`,
          clause_title: trimText(clause.clause_title) || trimText(file.display_name),
          clause_text: trimText(clause.clause_text),
          clause_type: trimText(clause.clause_type).toUpperCase() || 'GENERAL',
          response_mode: trimText(clause.response_mode).toUpperCase() || 'TEXT',
          mandatory_flag: normalizeBoolean(clause.mandatory_flag, false) ? 1 : 0,
          scoring_flag: normalizeBoolean(clause.scoring_flag, false) ? 1 : 0,
          score_value: Number.isFinite(Number(clause.score_value)) ? Number(clause.score_value) : null,
          source_role: file.file_role,
          sort_order: clauseSort,
          metadata_json: JSON.stringify({
            file_name: trimText(file.display_name || file.original_file_name),
            relative_path: trimText(file.relative_path) || null,
          }),
        });
        clauseSort += 1;
      }

      await run(
        `UPDATE tender_bid_parse_files
         SET parse_job_id = ?, status = 'PARSED', parse_summary_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [jobId, JSON.stringify(payload.parse_summary || {}), Number(file.id)]
      );
    }

    const mergedFields = mergeParsedProjectFields(mergedSources);
    const summary = {
      parse_scope: parseScope,
      parse_scope_label: parseScopeTitleMap[parseScope] || parseScopeTitleMap.FULL,
      file_count: parseableFiles.length,
      table_count: tableRows.length,
      clause_count: clauseRows.length,
      warning_count: warnings.length,
    };

    await transaction(async (tx) => {
      for (const table of tableRows) {
        await tx.run(
          `INSERT INTO tender_bid_parse_tables
            (bid_id, parse_job_id, source_file_id, table_name, source_sheet_name, row_count, column_count,
             summary_text, header_json, rows_json, source_role, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            table.bid_id,
            table.parse_job_id,
            table.source_file_id,
            table.table_name,
            table.source_sheet_name,
            table.row_count,
            table.column_count,
            table.summary_text,
            table.header_json,
            table.rows_json,
            table.source_role,
            table.sort_order,
          ]
        );
      }
      for (const clause of clauseRows) {
        await tx.run(
          `INSERT INTO tender_bid_parse_clauses
            (bid_id, parse_job_id, source_file_id, clause_code, clause_title, clause_text, clause_type,
             response_mode, mandatory_flag, scoring_flag, score_value, source_role, sort_order, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clause.bid_id,
            clause.parse_job_id,
            clause.source_file_id,
            clause.clause_code,
            clause.clause_title,
            clause.clause_text,
            clause.clause_type,
            clause.response_mode,
            clause.mandatory_flag,
            clause.scoring_flag,
            clause.score_value,
            clause.source_role,
            clause.sort_order,
            clause.metadata_json,
          ]
        );
      }
      await tx.run(
        `UPDATE tender_bid_parse_jobs
         SET status = 'COMPLETED', progress = 100, merged_fields_json = ?, field_sources_json = ?, summary_json = ?, warning_text = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          JSON.stringify(mergedFields.values || {}),
          JSON.stringify(mergedFields.sources || {}),
          JSON.stringify(summary),
          warnings.join('\n') || null,
          jobId,
        ]
      );
    });

    await refreshBidStatusAfterParseCompleted({ bidId, user: req.user });
    const detail = await ensureParseJobExists({ bidId, jobId });
    res.status(201).json(detail);
  } catch (err) {
    await run(
      `UPDATE tender_bid_parse_jobs
       SET status = 'FAILED', progress = 100, error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [trimText(err?.message || '解析失败').slice(0, 1000), jobId]
    );
    throw err;
  }
}));

app.get('/api/tender/bids/:id/parse/jobs/:jobId', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(jobId) || jobId <= 0) throw appError('任务ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const detail = await ensureParseJobExists({ bidId, jobId });
  res.json(detail);
}));

app.put('/api/tender/bids/:id/parse/clauses/bulk', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body?.clauses) ? req.body.clauses : []);
  if (!items.length) throw appError('items 不能为空', 400);

  const clauseIds = Array.from(new Set(items.map((item) => Number(item?.id || item?.clause_id)).filter((item) => Number.isFinite(item) && item > 0)));
  if (!clauseIds.length) throw appError('缺少有效的条款ID', 400);
  const existingRows = await query(
    `SELECT *
     FROM tender_bid_parse_clauses
     WHERE bid_id = ? AND id IN (${clauseIds.map(() => '?').join(',')})`,
    [bidId, ...clauseIds]
  );
  const existingMap = new Map(existingRows.map((item) => [Number(item.id), sanitizeParseClauseRow(item)]));
  if (existingMap.size !== clauseIds.length) throw appError('存在无效的条款ID', 404);

  await transaction(async (tx) => {
    for (const item of items) {
      const clauseId = Number(item?.id || item?.clause_id);
      const current = existingMap.get(clauseId);
      if (!current) continue;
      const clauseType = trimText(item?.clause_type).toUpperCase() || current.clause_type;
      const responseMode = trimText(item?.response_mode).toUpperCase() || current.response_mode;
      const mandatoryFlag = item?.mandatory_flag === undefined
        ? Number(current.mandatory_flag || 0)
        : (normalizeBoolean(item?.mandatory_flag, false) ? 1 : 0);
      const scoringFlag = item?.scoring_flag === undefined
        ? Number(current.scoring_flag || 0)
        : (normalizeBoolean(item?.scoring_flag, false) ? 1 : 0);
      const scoreValue = item?.score_value === undefined
        ? current.score_value
        : (Number.isFinite(Number(item?.score_value)) ? Number(item.score_value) : null);
      await tx.run(
        `UPDATE tender_bid_parse_clauses
         SET clause_type = ?, response_mode = ?, mandatory_flag = ?, scoring_flag = ?, score_value = ?, updated_at = NOW()
         WHERE id = ? AND bid_id = ?`,
        [clauseType || 'GENERAL', responseMode || 'TEXT', mandatoryFlag, scoringFlag, scoreValue, clauseId, bidId]
      );
    }
  });

  const latestJob = await loadLatestParseJobRow(bidId);
  const detail = latestJob ? await loadParseJobDetail(latestJob.id, { bidId }) : { clauses: [] };
  res.json({
    bid_id: bidId,
    updated_ids: clauseIds,
    clauses: detail?.clauses || [],
  });
}));

app.post('/api/tender/bids/:id/parse/matches/recommend', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });

  const requestedJobId = Number(req.body?.parse_job_id || 0);
  const latestJob = requestedJobId > 0
    ? sanitizeParseJobRow(await get('SELECT * FROM tender_bid_parse_jobs WHERE id = ? AND bid_id = ? LIMIT 1', [requestedJobId, bidId]))
    : await loadLatestParseJobRow(bidId);
  if (!latestJob) throw appError('请先执行解析', 409);

  const clauseIds = Array.from(new Set(
    (Array.isArray(req.body?.clause_ids) ? req.body.clause_ids : [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
  ));
  const clauseRows = await query(
    `SELECT *
     FROM tender_bid_parse_clauses
     WHERE parse_job_id = ? ${clauseIds.length ? `AND id IN (${clauseIds.map(() => '?').join(',')})` : ''}
     ORDER BY sort_order ASC, id ASC`,
    clauseIds.length ? [Number(latestJob.id), ...clauseIds] : [Number(latestJob.id)]
  );
  const clauses = clauseRows.map((item) => sanitizeParseClauseRow(item));

  const retrievalChunks = await loadParseRecommendationChunks(bidId);
  const feedbackIndex = await loadParseRecommendationFeedbackIndex();

  const recommendations = [];
  for (const clause of clauses) {
    const ranked = rankSemanticAssetRecommendations({
      clause,
      chunks: retrievalChunks,
      limit: 3,
      feedbackIndex,
    });
    for (const item of ranked) {
      recommendations.push({
        clause_id: Number(clause.id),
        asset_id: Number(item.asset_id || 0) || null,
        confidence: Number(item.confidence || 0),
        reason_text: trimText(item.reason_text) || null,
        match_source: trimText(item.match_source).toUpperCase() || 'HYBRID',
        payload: {
          recommended: true,
          chunk_id: trimText(item.chunk_id),
          chunk_type: trimText(item.chunk_type).toUpperCase() || 'GENERIC_ASSET',
          source_table: trimText(item.source_table),
          source_id: Number(item.source_id || 0) || null,
          semantic_score: Number(item.semantic_score || 0),
          rule_score: Number(item.rule_score || 0),
          rerank_score: Number(item.rerank_score || 0),
          feedback_score: Number(item.feedback_score || 0),
          feedback_summary: item.feedback_summary && typeof item.feedback_summary === 'object' ? item.feedback_summary : {},
          need_manual_review: !!item.need_manual_review,
          manual_review_reasons: Array.isArray(item.manual_review_reasons) ? item.manual_review_reasons : [],
          chunk_preview: trimText(item.chunk_preview),
          title: trimText(item.title),
        },
      });
    }
  }

  await transaction(async (tx) => {
    if (clauses.length) {
      await tx.run(
        `DELETE FROM tender_bid_parse_matches
         WHERE bid_id = ? AND parse_job_id = ? AND match_status = 'RECOMMENDED' AND clause_id IN (${clauses.map(() => '?').join(',')})`,
        [bidId, Number(latestJob.id), ...clauses.map((item) => Number(item.id))]
      );
    }
    for (const item of recommendations) {
      await tx.run(
        `INSERT INTO tender_bid_parse_matches
          (bid_id, parse_job_id, clause_id, asset_id, match_status, confidence, reason_text, match_source, payload_json, created_by_id, created_by_name, updated_by_id, updated_by_name)
         VALUES (?, ?, ?, ?, 'RECOMMENDED', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bidId,
          Number(latestJob.id),
          item.clause_id,
          Number.isFinite(Number(item.asset_id)) && Number(item.asset_id) > 0 ? Number(item.asset_id) : null,
          item.confidence,
          item.reason_text,
          item.match_source,
          JSON.stringify(item.payload || { recommended: true }),
          Number(req.user.id || 0) || null,
          trimText(req.user.username) || null,
          Number(req.user.id || 0) || null,
          trimText(req.user.username) || null,
        ]
      );
    }
  });

  const detail = await loadParseJobDetail(latestJob.id, { bidId });
  res.json({
    bid_id: bidId,
    parse_job_id: Number(latestJob.id),
    matches: detail?.matches || [],
  });
}));

app.put('/api/tender/bids/:id/parse/matches/bulk', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body?.matches) ? req.body.matches : []);
  if (!items.length) throw appError('items 不能为空', 400);

  const latestJob = await loadLatestParseJobRow(bidId);
  if (!latestJob) throw appError('请先执行解析', 409);
  const clauseIds = Array.from(new Set(items.map((item) => Number(item?.clause_id)).filter((item) => Number.isFinite(item) && item > 0)));
  const matchIds = Array.from(new Set(items.map((item) => Number(item?.id || item?.match_id)).filter((item) => Number.isFinite(item) && item > 0)));
  const clauseMap = clauseIds.length
    ? new Map((await query(
      `SELECT id
       FROM tender_bid_parse_clauses
       WHERE bid_id = ? AND parse_job_id = ? AND id IN (${clauseIds.map(() => '?').join(',')})`,
      [bidId, Number(latestJob.id), ...clauseIds]
    )).map((item) => [Number(item.id), true]))
    : new Map();
  const existingMatchMap = matchIds.length
    ? new Map((await query(
      `SELECT id, payload_json
       FROM tender_bid_parse_matches
       WHERE bid_id = ? AND id IN (${matchIds.map(() => '?').join(',')})`,
      [bidId, ...matchIds]
    )).map((item) => [Number(item.id), item]))
    : new Map();

  await transaction(async (tx) => {
    for (const item of items) {
      const matchId = Number(item?.id || item?.match_id);
      const clauseId = Number(item?.clause_id);
      const assetId = Number(item?.asset_id);
      const matchStatus = normalizeParseMatchStatus(item?.match_status || item?.status);
      if (!matchStatus) throw appError('匹配状态不合法', 400);

      if (Number.isFinite(matchId) && matchId > 0) {
        const existing = existingMatchMap.get(matchId) || null;
        const payload = buildParseMatchPayloadWithFeedback({
          basePayload: parseMaybeJson(existing?.payload_json, {}),
          nextPayload: item?.payload,
          matchStatus,
          user: req.user,
        });
        await tx.run(
          `UPDATE tender_bid_parse_matches
           SET asset_id = ?, match_status = ?, confidence = ?, reason_text = ?, payload_json = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
           WHERE id = ? AND bid_id = ?`,
          [
            Number.isFinite(assetId) && assetId > 0 ? assetId : null,
            matchStatus,
            Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0,
            trimText(item?.reason_text) || null,
            JSON.stringify(payload),
            Number(req.user.id || 0) || null,
            trimText(req.user.username) || null,
            matchId,
            bidId,
          ]
        );
        continue;
      }

      if (!clauseMap.has(clauseId)) throw appError('存在无效的条款ID', 404);
      const payload = buildParseMatchPayloadWithFeedback({
        basePayload: {},
        nextPayload: item?.payload,
        matchStatus,
        user: req.user,
      });
      await tx.run(
        `INSERT INTO tender_bid_parse_matches
          (bid_id, parse_job_id, clause_id, asset_id, match_status, confidence, reason_text, match_source, payload_json, created_by_id, created_by_name, updated_by_id, updated_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?)`,
        [
          bidId,
          Number(latestJob.id),
          clauseId,
          Number.isFinite(assetId) && assetId > 0 ? assetId : null,
          matchStatus,
          Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0,
          trimText(item?.reason_text) || null,
          JSON.stringify(payload),
          Number(req.user.id || 0) || null,
          trimText(req.user.username) || null,
          Number(req.user.id || 0) || null,
          trimText(req.user.username) || null,
        ]
      );
    }
  });

  const detail = await loadParseJobDetail(latestJob.id, { bidId });
  res.json({
    bid_id: bidId,
    parse_job_id: Number(latestJob.id),
    matches: detail?.matches || [],
  });
}));

app.post('/api/tender/bids/:id/check', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const currentVersion = await getCurrentVersion(bid);
  const draft = sanitizeDraftRow(await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [bidId]));
  if (!currentVersion && !draft) throw appError('标书尚无可校验稿件', 409);

  const latestJob = await loadLatestGenerateJobForBid(bidId);
  const latestDetail = latestJob ? await loadGenerateJobDetail(latestJob.id) : null;
  let requirementRegistry = latestJob ? await loadRequirementRegistryRows(latestJob.id) : [];
  if (!requirementRegistry.length && latestDetail) {
    requirementRegistry = buildRuntimeRequirementRegistry({ detail: latestDetail });
  }
  const clauseRegistryV2 = buildClauseRegistryV2({
    requirements: requirementRegistry,
  });
  const evidenceRegistry = await loadEvidenceRegistryRows(bidId);
  let draftSections = currentVersion
    ? await loadDraftSectionRegistryRows({ bidId, versionId: Number(currentVersion.id) })
    : [];
  const draftArtifacts = currentVersion
    ? await loadDraftArtifactRows({ bidId, versionId: Number(currentVersion.id) })
    : [];

  const draftFilePath = trimText(draft?.draft_file_path) || trimText(currentVersion?.storage_path);
  const paragraphs = await extractParagraphsFromDocx(draftFilePath);
  if (!draftSections.length && paragraphs.length) {
    draftSections = paragraphs.map((paragraph, index) => ({
      section_title: '文档正文',
      paragraph_no: index + 1,
      paragraph_text: paragraph,
      requirement_ids_json: '[]',
      evidence_ids_json: '[]',
      score_item_ids_json: '[]',
    }));
  }

  const analyzeSummary = parseMaybeJson(latestDetail?.job?.analysis_summary_json, {});
  const analyzeStageOutputs = isPlainObject(analyzeSummary?.stage_outputs) ? analyzeSummary.stage_outputs : {};
  const analyzeBidCategory = normalizeBidCategory(latestDetail?.job?.bid_category) || 'SERVICE';
  const analyzeFinalJson = normalizeFinalAnalyzeJson(analyzeSummary?.final_json || {}, analyzeBidCategory);
  const projectCoreInfo = isPlainObject(analyzeFinalJson?.project_core_info) ? analyzeFinalJson.project_core_info : {};
  const checkContext = {
    expected_project_name: firstNonEmpty(projectCoreInfo.project_full_name, projectCoreInfo.project_name, bid.project_name),
    expected_project_no: firstNonEmpty(projectCoreInfo.project_code, projectCoreInfo.package_no),
    expected_duration: firstNonEmpty(
      projectCoreInfo.project_duration,
      projectCoreInfo.service_duration,
      projectCoreInfo.delivery_period
    ),
    expected_contact: firstNonEmpty(projectCoreInfo.contact_person, projectCoreInfo.contact_name),
    chapter_quality_summary: isPlainObject(analyzeStageOutputs?.chapter_quality_summary)
      ? analyzeStageOutputs.chapter_quality_summary
      : null,
    as_of_date: new Date().toISOString().slice(0, 10),
  };

  const structuredResult = runStructuredChecks({
    requirements: requirementRegistry,
    sections: draftSections,
    evidences: evidenceRegistry,
    artifacts: draftArtifacts,
    paragraphs,
    context: checkContext,
  });
  const docxResult = runDocxChecks({ paragraphs });
  const rawCheckResult = mergeCheckResults(structuredResult, docxResult);
  const activeValidationRules = await loadValidationRuleRows({
    activeOnly: true,
    limit: 500,
  });
  const checkIssues = decorateIssuesWithRules({
    issues: rawCheckResult.issues,
    rules: activeValidationRules,
  });
  const ruleExecution = buildRuleExecutionSummary({
    rules: activeValidationRules,
    issues: checkIssues,
  });
  const checkResult = {
    ...rawCheckResult,
    issues: checkIssues,
    rule_execution: ruleExecution,
  };

  const checkRunId = await transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO tender_draft_check_runs
        (bid_id, version_id, draft_id, status, summary_json, created_by_id, created_by_name)
       VALUES (?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      [
        Number(bidId),
        Number(currentVersion?.id || 0) || null,
        Number(draft?.id || 0) || null,
        JSON.stringify(checkResult.summary),
        Number(req.user.id || 0) || null,
        trimText(req.user.username) || null,
      ]
    );
    const runId = Number(inserted.insertId);
    for (let i = 0; i < checkResult.issues.length; i += 1) {
      const issue = checkResult.issues[i];
      await tx.run(
        `INSERT INTO tender_draft_check_issues
          (check_run_id, bid_id, issue_type, severity, title, message, requirement_code, requirement_title, section_title, paragraph_text, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          Number(bidId),
          trimText(issue.type),
          trimText(issue.severity) || 'WARN',
          trimText(issue.title) || null,
          trimText(issue.message) || null,
          trimText(issue.requirement_code) || null,
          trimText(issue.requirement_title) || null,
          trimText(issue.section_title) || null,
          trimText(issue.paragraph_text) || null,
          i + 1,
        ]
      );
    }
    return runId;
  });

  await logOperation({
    req,
    action: 'BID_DRAFT_CHECK',
    entity: 'bid',
    entityId: bidId,
    message: `执行成稿校验 ${bid.bid_no}`,
    afterData: {
      check_run_id: checkRunId,
      issue_count: Number(checkResult.summary.issue_count || 0),
      fatal_count: Number(checkResult.summary.fatal_count || 0),
      warn_count: Number(checkResult.summary.warn_count || 0),
      source_job_id: Number(latestJob?.id || 0) || null,
    },
  });

  res.json({
    ok: true,
    run_id: checkRunId,
    bid,
    version: currentVersion,
    draft,
    source_job_id: Number(latestJob?.id || 0) || null,
    requirement_registry: requirementRegistry,
    clause_registry_v2: clauseRegistryV2,
    evidence_registry: evidenceRegistry,
    draft_sections: draftSections,
    summary: checkResult.summary,
    rule_execution: checkResult.rule_execution,
    issues: checkResult.issues,
  });
}));

app.post('/api/tender/bids/:id/score-optimize', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const currentVersion = await getCurrentVersion(bid);
  const draft = sanitizeDraftRow(await get('SELECT * FROM tender_bid_drafts WHERE bid_id = ? LIMIT 1', [bidId]));
  const latestJob = await loadLatestGenerateJobForBid(bidId);
  const linkedKbProject = await loadLinkedKbProjectByBid(bid);
  let requirementRegistry = latestJob ? await loadRequirementRegistryRows(latestJob.id) : [];
  if (!requirementRegistry.length && latestJob) {
    const detail = await loadGenerateJobDetail(latestJob.id);
    requirementRegistry = buildRuntimeRequirementRegistry({ detail });
  }
  const clauseRegistryV2 = buildClauseRegistryV2({
    requirements: requirementRegistry,
  });
  const evidenceRegistry = await loadEvidenceRegistryRows(bidId);
  let draftSections = currentVersion
    ? await loadDraftSectionRegistryRows({ bidId, versionId: Number(currentVersion.id) })
    : [];
  if (!draftSections.length) {
    const draftFilePath = trimText(draft?.draft_file_path) || trimText(currentVersion?.storage_path);
    const paragraphs = await extractParagraphsFromDocx(draftFilePath);
    if (paragraphs.length) {
      draftSections = paragraphs.map((paragraph, index) => ({
        section_title: '文档正文',
        paragraph_no: index + 1,
        paragraph_text: paragraph,
        requirement_ids_json: '[]',
        evidence_ids_json: '[]',
        score_item_ids_json: '[]',
      }));
    }
  }

  const matrix = buildScoreCoverageMatrix({
    requirements: requirementRegistry,
    sections: draftSections,
    evidences: evidenceRegistry,
  });
  const candidates = pickOptimizationCandidates(matrix);
  const promptPreview = buildScoreOptimizationPrompt({ candidates });
  const baselineSuggestionItems = candidates.map((item) => ({
    score_item_id: item.score_item_id,
    suggestion_title: `补强${trimText(item.title) || trimText(item.score_item_id)}`,
    suggestion_text: item.coverage_status === 'NONE'
      ? `当前评分项“${trimText(item.title) || trimText(item.score_item_id)}”尚未形成章节覆盖，建议新增专章回应评分标准，并绑定对应案例、资质或人员材料。`
      : `当前评分项“${trimText(item.title) || trimText(item.score_item_id)}”已有文字覆盖，但证据偏弱，建议补充更直接的案例、人员、资质或承诺材料形成闭环。`,
    evidence_ids: parseMaybeJson(item.bound_evidence_ids_json, []),
    source: 'RULE',
  }));
  const normalizedBaseline = normalizeOptimizationResponse({
    items: baselineSuggestionItems,
  });

  const warnings = [];
  let aiSuggestionItems = [];
  const aiModelId = Number(req.body?.model_id || 0);
  if (normalizedBaseline.items.length > 0) {
    try {
      const aiTask = await runAiTask({
        req,
        taskType: 'REWRITE',
        modelId: Number.isFinite(aiModelId) && aiModelId > 0 ? aiModelId : null,
        inputText: JSON.stringify({
          task: 'score_optimize_rewrite',
          instruction: '请将以下评分优化候选项改写为更具体可执行的高分应答建议，仅输出JSON对象：{"items":[{"score_item_id":"","suggestion_title":"","suggestion_text":"","evidence_ids":[]}]}。',
          candidates: normalizedBaseline.items,
        }),
      });
      const aiNormalized = normalizeOptimizationResponse(aiTask?.parsed || {});
      if (aiNormalized.items.length > 0) {
        aiSuggestionItems = aiNormalized.items.map((item) => ({
          ...item,
          source: 'AI',
        }));
      }
    } catch (err) {
      warnings.push(`评分优化模型改写失败，已回退规则建议：${trimText(err.message).slice(0, 120)}`);
    }
  }

  const suggestionMap = new Map();
  for (const item of normalizedBaseline.items) {
    suggestionMap.set(trimText(item.score_item_id), { ...item, source: 'RULE' });
  }
  for (const item of aiSuggestionItems) {
    const key = trimText(item.score_item_id);
    if (!key) continue;
    suggestionMap.set(key, item);
  }
  const strategyInputs = await loadWinningStrategyInputs({ limit: 40 });
  const strategyProfiles = buildWinningStrategyProfiles(strategyInputs);
  const selectedStrategyProfile = pickWinningStrategyProfile({
    profiles: strategyProfiles,
    projectType: trimText(linkedKbProject?.project_type),
    industryType: trimText(linkedKbProject?.industry_type),
  });
  const strategyLearning = applyWinningStrategyToSuggestions({
    items: Array.from(suggestionMap.values()),
    profile: selectedStrategyProfile,
  });
  const normalized = normalizeOptimizationResponse({
    items: strategyLearning.items,
  });
  const applyResult = applyOptimizationToSections({
    sections: draftSections,
    items: normalized.items,
  });
  const appliedRows = applyResult.applied_records.map((item) => {
    const source = trimText(suggestionMap.get(trimText(item.score_item_id))?.source) || trimText(item.source) || 'RULE';
    const sourceWithLearning = trimText(item.strategy_profile_key)
      ? `${source}_LEARNED`
      : source;
    return {
      ...item,
      source: sourceWithLearning,
      applied_flag: 1,
      status: 'APPLIED',
    };
  });

  await transaction(async (tx) => {
    await persistScoreCoverageMatrix(tx, {
      bidId,
      versionId: Number(currentVersion?.id || 0) || null,
      rows: matrix,
    });
    if (currentVersion?.id) {
      await persistDraftSectionRegistry(tx, bidId, Number(currentVersion.id), applyResult.sections);
    }
    await persistScoreOptimizationRecords(tx, {
      bidId,
      versionId: Number(currentVersion?.id || 0) || null,
      rows: appliedRows,
      user: req.user,
    });
  });

  await logOperation({
    req,
    action: 'BID_SCORE_OPTIMIZE',
    entity: 'bid',
    entityId: bidId,
    message: `执行评分优化 ${bid.bid_no}`,
    afterData: {
      source_job_id: Number(latestJob?.id || 0) || null,
      candidate_count: normalized.items.length,
      applied_count: applyResult.applied_count,
      strategy_profile: strategyLearning.profile,
      strategy_matched_count: Number(strategyLearning.matched_count || 0),
    },
  });

  res.json({
    ok: true,
    bid,
    version: currentVersion,
    draft,
    source_job_id: Number(latestJob?.id || 0) || null,
    clause_registry_v2: clauseRegistryV2,
    matrix,
    items: appliedRows,
    applied_count: applyResult.applied_count,
    applied_records: appliedRows,
    draft_sections: applyResult.sections,
    strategy_profile: strategyLearning.profile,
    strategy_matched_count: Number(strategyLearning.matched_count || 0),
    prompt_preview: promptPreview,
    warnings,
  });
}));

app.post('/api/tender/bids', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const title = fixMojibakeText(trimText(req.body?.title));
  const customer_name = fixMojibakeText(trimText(req.body?.customer_name));
  const project_name = fixMojibakeText(trimText(req.body?.project_name));
  const summary = fixMojibakeText(trimText(req.body?.summary));
  const status = normalizeStatus(req.body?.status || 'DRAFT');
  const sourceKbProjectIdNum = Number(req.body?.source_kb_project_id);
  const sourceKbProjectId = Number.isFinite(sourceKbProjectIdNum) && sourceKbProjectIdNum > 0
    ? Math.floor(sourceKbProjectIdNum)
    : null;
  const reviewStage = inferReviewStageByBidStatus(status);
  const reviewStatus = status.endsWith('_REVIEW_PENDING') ? 'submitted' : 'draft';

  if (!title) throw appError('标书标题不能为空', 400);
  if (!customer_name) throw appError('客户名称不能为空', 400);
  if (!project_name) throw appError('项目名称不能为空', 400);

  const bidNo = await nextBidNo();
  const bidId = await transaction(async (tx) => {
    const info = await tx.run(
      `INSERT INTO tender_bids
        (bid_no, title, customer_name, project_name, source_kb_project_id, status, review_status, review_stage, summary, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bidNo,
        title,
        customer_name,
        project_name,
        sourceKbProjectId,
        status,
        reviewStatus,
        reviewStage,
        summary || null,
        Number(req.user.id),
        req.user.username,
        Number(req.user.id),
        req.user.username,
      ]
    );
    const row = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [info.insertId]);
    await ensureBidMembers({ bid: row, members: [], req, tx });
    return Number(info.insertId);
  });

  const [row] = await withBidMembers([await get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId])]);

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

  const before = await ensureBidExists(id, { user: req.user });
  const title = fixMojibakeText(trimText(req.body?.title)) || before.title;
  const customer_name = fixMojibakeText(trimText(req.body?.customer_name)) || before.customer_name;
  const project_name = fixMojibakeText(trimText(req.body?.project_name)) || before.project_name;
  const summary = req.body?.summary === undefined ? before.summary : fixMojibakeText(trimText(req.body?.summary));
  const sourceKbProjectIdRaw = req.body?.source_kb_project_id;
  const sourceKbProjectId = sourceKbProjectIdRaw === undefined
    ? (Number.isFinite(Number(before.source_kb_project_id)) ? Number(before.source_kb_project_id) : null)
    : (() => {
      const num = Number(sourceKbProjectIdRaw);
      return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
    })();

  await run(
    `UPDATE tender_bids
     SET title = ?, customer_name = ?, project_name = ?, source_kb_project_id = ?, summary = ?,
         updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [title, customer_name, project_name, sourceKbProjectId, summary || null, Number(req.user.id), req.user.username, id]
  );

  const row = await ensureBidExists(id, { user: req.user });
  await logOperation({
    req,
    action: 'BID_UPDATE',
    entity: 'bid',
    entityId: id,
    message: `更新标书 ${row.bid_no}`,
    beforeData: before,
    afterData: row,
  });

  res.json(sanitizeBidRow(row));
}));

app.delete('/api/tender/bids/:id', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('标书ID无效', 400);

  const before = await ensureBidExists(id, { user: req.user });
  const versionRows = await query(
    `SELECT id, storage_path, file_name
     FROM tender_bid_versions
     WHERE bid_id = ?`,
    [id]
  );
  const draftRows = await query(
    `SELECT id, draft_file_path, draft_file_name
     FROM tender_bid_drafts
     WHERE bid_id = ?`,
    [id]
  );
  const autosaveRows = await query(
    `SELECT id, storage_path
     FROM tender_bid_draft_autosaves
     WHERE bid_id = ?`,
    [id]
  );
  const exportRows = await query(
    `SELECT id, storage_path
     FROM tender_bid_export_records
     WHERE bid_id = ?`,
    [id]
  );
  const assetRows = await query(
    `SELECT id, storage_path, original_file_name
     FROM tender_assets
     WHERE bid_id = ?`,
    [id]
  );
  const parseFileRows = await query(
    `SELECT id, storage_path
     FROM tender_bid_parse_files
     WHERE bid_id = ?`,
    [id]
  );
  const assetIds = assetRows
    .map((item) => Number(item.id))
    .filter((item) => Number.isFinite(item) && item > 0);

  await withDeadlockRetry(
    () => transaction(async (tx) => {
      if (assetIds.length) {
        const placeholders = assetIds.map(() => '?').join(',');
        await tx.run(`DELETE FROM tender_asset_ocr_results WHERE asset_id IN (${placeholders})`, assetIds);
      }
      await tx.run('DELETE FROM tender_editor_sessions WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_field_values WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_reviews WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_draft_check_issues WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_draft_check_runs WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_score_optimization_records WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_score_coverage_matrix WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_draft_artifact_rows WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_draft_section_registry WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_draft_autosaves WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_export_records WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_parse_matches WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_parse_clauses WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_parse_tables WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_parse_jobs WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_parse_files WHERE bid_id = ?', [id]);
      await tx.run('UPDATE tender_bid_generate_jobs SET created_bid_id = NULL WHERE created_bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_versions WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bid_drafts WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_assets WHERE bid_id = ?', [id]);
      await tx.run('DELETE FROM tender_bids WHERE id = ?', [id]);
    }),
    { maxRetries: 2, baseDelayMs: 100 }
  );

  const filePathSet = new Set([
    ...versionRows.map((item) => trimText(item.storage_path)),
    ...draftRows.map((item) => trimText(item.draft_file_path)),
    ...autosaveRows.map((item) => trimText(item.storage_path)),
    ...exportRows.map((item) => trimText(item.storage_path)),
    ...assetRows.map((item) => trimText(item.storage_path)),
    ...parseFileRows.map((item) => trimText(item.storage_path)),
  ].filter(Boolean));
  for (const filePath of filePathSet) {
    await deleteFileSafe(filePath);
  }

  await logOperation({
    req,
    action: 'BID_DELETE',
    entity: 'bid',
    entityId: id,
    message: `删除标书 ${before.bid_no}`,
    beforeData: {
      bid_no: before.bid_no,
      title: before.title,
      status: before.status,
      version_count: versionRows.length,
      draft_count: draftRows.length,
      autosave_count: autosaveRows.length,
      asset_count: assetRows.length,
      parse_file_count: parseFileRows.length,
    },
    afterData: { deleted: true },
  });

  res.json({
    ok: true,
    id,
    deleted: {
      version_count: versionRows.length,
      draft_count: draftRows.length,
      autosave_count: autosaveRows.length,
      asset_count: assetRows.length,
      parse_file_count: parseFileRows.length,
    },
  });
}));

app.post('/api/tender/bids/:id/status', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = normalizeStatus(req.body?.status);
  if (!Number.isFinite(id) || id <= 0) throw appError('标书ID无效', 400);

  const before = await ensureBidExists(id, { user: req.user });
  const fromStatus = normalizeStatus(before.status);

  if (fromStatus !== nextStatus) {
    const allowed = statusTransitions[fromStatus] || new Set();
    if (!allowed.has(nextStatus)) {
      throw appError(`状态不允许从 ${fromStatus} 变更为 ${nextStatus}`, 400);
    }
  }

  if (new Set(['ARCHIVED', 'EXPORTED', 'SUBMITTED']).has(nextStatus) && !normalizeBoolean(req.body?.confirm, false)) {
    throw appError('该状态变更需要确认，请传 confirm=true', 400);
  }

  const reviewStage = inferReviewStageByBidStatus(nextStatus);
  const reviewStatus = nextStatus.endsWith('_REVIEW_PENDING')
    ? 'submitted'
    : (['EXPORT_READY', 'EXPORTED', 'SUBMITTED'].includes(nextStatus) ? 'approved' : 'draft');

  const submittedFields = ['SUBMITTED', 'EXPORTED'].includes(nextStatus)
    ? ', submitted_at = NOW(), submitted_by_id = ?, submitted_by_name = ?'
    : '';
  const archivedFields = nextStatus === 'ARCHIVED'
    ? ', archived_at = NOW(), archived_by_id = ?, archived_by_name = ?'
    : '';

  const params = [nextStatus, reviewStatus, reviewStage, Number(req.user.id), req.user.username];
  if (['SUBMITTED', 'EXPORTED'].includes(nextStatus)) {
    params.push(Number(req.user.id), req.user.username);
  }
  if (nextStatus === 'ARCHIVED') {
    params.push(Number(req.user.id), req.user.username);
  }
  params.push(id);

  await run(
    `UPDATE tender_bids
     SET status = ?, review_status = ?, review_stage = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     ${submittedFields}
     ${archivedFields}
     WHERE id = ?`,
    params
  );

  const after = await ensureBidExists(id, { user: req.user });
  await logOperation({
    req,
    action: 'BID_STATUS',
    entity: 'bid',
    entityId: id,
    message: `标书状态变更 ${fromStatus} -> ${nextStatus}`,
    beforeData: { status: fromStatus },
    afterData: { status: nextStatus },
  });

  res.json(sanitizeBidRow(after));
}));

app.get('/api/tender/bids/:id/reviews', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });

  const limit = Math.min(100, toBoundedLimit(req.query.limit, 30));
  const rows = await query(
    `SELECT *
     FROM tender_bid_reviews
     WHERE bid_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [bidId, limit]
  );
  res.json(rows.map((row) => ({
    ...row,
    submitted_by_name: fixMojibakeText(row.submitted_by_name),
    reviewer_name: fixMojibakeText(row.reviewer_name),
    review_comment: fixMojibakeText(row.review_comment),
  })));
}));

app.post('/api/tender/bids/:id/reviews/submit', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });

  const reviewStage = normalizeReviewStage(req.body?.review_stage || inferReviewStageByBidStatus(bid.status));
  const pendingStatus = reviewStageToPendingStatus[reviewStage] || 'COMPILE_REVIEW_PENDING';
  const fromStatus = normalizeStatus(bid.status);

  if (fromStatus !== pendingStatus) {
    const allowed = statusTransitions[fromStatus] || new Set();
    if (!allowed.has(pendingStatus)) {
      throw appError(`当前状态不支持提交到 ${reviewStage} 审核`, 400);
    }
  }

  const reviewerIdNum = Number(req.body?.reviewer_id);
  const reviewerId = Number.isFinite(reviewerIdNum) && reviewerIdNum > 0 ? Math.floor(reviewerIdNum) : null;
  const reviewerName = fixMojibakeText(trimText(req.body?.reviewer_name));
  const reviewComment = fixMojibakeText(trimText(req.body?.review_comment));

  const created = await transaction(async (tx) => {
    const roundRow = await tx.get(
      'SELECT COALESCE(MAX(review_round), 0) AS max_round FROM tender_bid_reviews WHERE bid_id = ?',
      [bidId]
    );
    const nextRound = Number(roundRow?.max_round || 0) + 1;

    const reviewInsert = await tx.run(
      `INSERT INTO tender_bid_reviews
        (bid_id, review_round, review_stage, review_status, submitted_by_id, submitted_by_name, reviewer_id, reviewer_name, review_comment, submitted_at)
       VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, NOW())`,
      [
        bidId,
        nextRound,
        reviewStage,
        Number(req.user.id),
        req.user.username,
        reviewerId,
        reviewerName || null,
        reviewComment || null,
      ]
    );

    await tx.run(
      `UPDATE tender_bids
       SET status = ?, review_status = 'submitted', review_stage = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [pendingStatus, reviewStage, Number(req.user.id), req.user.username, bidId]
    );

    const review = await tx.get('SELECT * FROM tender_bid_reviews WHERE id = ? LIMIT 1', [reviewInsert.insertId]);
    const afterBid = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
    return { review, bid: sanitizeBidRow(afterBid) };
  });

  await logOperation({
    req,
    action: 'BID_REVIEW_SUBMIT',
    entity: 'bid',
    entityId: bidId,
    message: `提交${reviewStage}审核`,
    afterData: {
      review_stage: reviewStage,
      review_id: Number(created.review?.id || 0) || null,
      pending_status: pendingStatus,
      reviewer_id: reviewerId,
      reviewer_name: reviewerName || null,
    },
  });

  res.status(201).json({
    review: {
      ...created.review,
      submitted_by_name: fixMojibakeText(created.review?.submitted_by_name),
      reviewer_name: fixMojibakeText(created.review?.reviewer_name),
      review_comment: fixMojibakeText(created.review?.review_comment),
    },
    bid: created.bid,
  });
}));

app.post('/api/tender/bids/:id/reviews/:reviewId/action', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const reviewId = Number(req.params.reviewId);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(reviewId) || reviewId <= 0) throw appError('审核记录ID无效', 400);

  const action = normalizeReviewStatus(req.body?.action || req.body?.review_status);
  if (!['approved', 'returned', 'rejected', 'conditional'].includes(action)) {
    throw appError('审核动作无效', 400);
  }

  const reviewComment = fixMojibakeText(trimText(req.body?.review_comment));
  const reviewerIdNum = Number(req.body?.reviewer_id);
  const reviewerId = Number.isFinite(reviewerIdNum) && reviewerIdNum > 0 ? Math.floor(reviewerIdNum) : Number(req.user.id);
  const reviewerName = fixMojibakeText(trimText(req.body?.reviewer_name)) || req.user.username;

  const result = await transaction(async (tx) => {
    const review = await tx.get(
      'SELECT * FROM tender_bid_reviews WHERE id = ? AND bid_id = ? LIMIT 1',
      [reviewId, bidId]
    );
    if (!review) throw appError('审核记录不存在', 404);
    if (normalizeReviewStatus(review.review_status) !== 'submitted') {
      throw appError('该审核记录已处理，不能重复操作', 409);
    }

    const bid = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
    if (!bid) throw appError('标书不存在', 404);

    const reviewStage = normalizeReviewStage(review.review_stage);
    let targetStatus;
    if (action === 'approved') {
      targetStatus = reviewStageToNextStatusOnApproved[reviewStage] || 'EXPORT_READY';
    } else if (action === 'conditional') {
      targetStatus = reviewStageToPendingStatus[reviewStage] || 'COMPILE_REVIEW_PENDING';
    } else if (action === 'returned') {
      if (reviewStage === 'FINAL') targetStatus = 'BUSINESS_REVIEW_PENDING';
      else if (reviewStage === 'BUSINESS') targetStatus = 'TECH_REVIEW_PENDING';
      else if (reviewStage === 'TECH') targetStatus = 'COMPILE_REVIEW_PENDING';
      else targetStatus = 'READY_TO_GENERATE';
    } else {
      targetStatus = 'DRAFT';
    }

    const fromStatus = normalizeStatus(bid.status);
    if (fromStatus !== targetStatus) {
      const allowed = statusTransitions[fromStatus] || new Set();
      if (!allowed.has(targetStatus)) {
        throw appError(`状态不允许从 ${fromStatus} 变更为 ${targetStatus}`, 400);
      }
    }

    const nextReviewStatus = targetStatus.endsWith('_REVIEW_PENDING')
      ? 'submitted'
      : (['EXPORT_READY', 'EXPORTED', 'SUBMITTED'].includes(targetStatus) ? 'approved' : action);
    const nextReviewStage = inferReviewStageByBidStatus(targetStatus);

    await tx.run(
      `UPDATE tender_bid_reviews
       SET review_status = ?, reviewer_id = ?, reviewer_name = ?, review_comment = ?, handled_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [action, reviewerId, reviewerName, reviewComment || null, reviewId]
    );

    await tx.run(
      `UPDATE tender_bids
       SET status = ?, review_status = ?, review_stage = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [targetStatus, nextReviewStatus, nextReviewStage, Number(req.user.id), req.user.username, bidId]
    );

    const afterReview = await tx.get('SELECT * FROM tender_bid_reviews WHERE id = ? LIMIT 1', [reviewId]);
    const afterBid = await tx.get('SELECT * FROM tender_bids WHERE id = ? LIMIT 1', [bidId]);
    return {
      review: afterReview,
      bid: sanitizeBidRow(afterBid),
      targetStatus,
      action,
    };
  });

  await logOperation({
    req,
    action: 'BID_REVIEW_ACTION',
    entity: 'bid',
    entityId: bidId,
    message: `审核动作：${action}`,
    afterData: {
      review_id: reviewId,
      action,
      target_status: result.targetStatus,
    },
  });

  res.json({
    review: {
      ...result.review,
      submitted_by_name: fixMojibakeText(result.review?.submitted_by_name),
      reviewer_name: fixMojibakeText(result.review?.reviewer_name),
      review_comment: fixMojibakeText(result.review?.review_comment),
    },
    bid: result.bid,
  });
}));

app.get('/api/tender/bids/:id/draft/autosaves', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });

  const limit = Math.min(100, toBoundedLimit(req.query.limit, 20));
  const rows = await query(
    `SELECT *
     FROM tender_bid_draft_autosaves
     WHERE bid_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [bidId, limit]
  );
  res.json(rows.map((row) => sanitizeDraftAutosaveRow(row)));
}));

app.post('/api/tender/bids/:id/draft/autosave', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });
  const draft = await ensureDraftForBid({ bid, user: req.user });

  const sourceRaw = trimText(req.body?.source).toUpperCase();
  const source = ['AUTO', 'MANUAL', 'EDITOR', 'ONLYOFFICE', 'SYSTEM'].includes(sourceRaw) ? sourceRaw : 'MANUAL';
  const note = fixMojibakeText(trimText(req.body?.note)).slice(0, 255);
  const providedHash = trimText(req.body?.content_hash).toLowerCase();
  const contentText = trimText(req.body?.content_text);

  const draftStat = await readFileStatSafe(draft.draft_file_path);
  if (!draftStat?.isFile()) throw appError('草稿文件不存在', 404);

  const copiedPath = await copyToManagedPath(draft.draft_file_path, DRAFT_ROOT, '.docx');
  const copiedStat = await readFileStatSafe(copiedPath);
  const contentHash = providedHash
    || (contentText ? sha256Hex(contentText) : sha256Hex(`${copiedPath}:${Number(copiedStat?.size || 0)}:${String(copiedStat?.mtimeMs || '')}`));

  const info = await run(
    `INSERT INTO tender_bid_draft_autosaves
      (bid_id, draft_id, version_id, storage_path, file_name, file_size, source, content_hash, note, saved_by_id, saved_by_name, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      bidId,
      Number(draft.id),
      Number(bid.current_version_id || 0) || null,
      copiedPath,
      path.basename(copiedPath),
      Number(copiedStat?.size || 0),
      source,
      contentHash || null,
      note || null,
      Number(req.user.id),
      req.user.username,
    ]
  );

  await run(
    `UPDATE tender_bid_drafts
     SET last_saved_at = NOW(), updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
     WHERE id = ?`,
    [Number(req.user.id), req.user.username, Number(draft.id)]
  );

  const row = await get('SELECT * FROM tender_bid_draft_autosaves WHERE id = ? LIMIT 1', [info.insertId]);

  await logOperation({
    req,
    action: 'DRAFT_AUTOSAVE',
    entity: 'bid',
    entityId: bidId,
    message: '草稿自动保存',
    afterData: {
      autosave_id: Number(info.insertId),
      source,
      file_size: Number(copiedStat?.size || 0),
      content_hash: contentHash || null,
    },
  });

  res.status(201).json(sanitizeDraftAutosaveRow(row));
}));

app.post('/api/tender/bids/:id/draft/rollback', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const autosaveId = Number(req.body?.autosave_id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(autosaveId) || autosaveId <= 0) throw appError('autosave_id无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const draft = await ensureDraftForBid({ bid, user: req.user });
  const autosave = await get(
    'SELECT * FROM tender_bid_draft_autosaves WHERE id = ? AND bid_id = ? LIMIT 1',
    [autosaveId, bidId]
  );
  if (!autosave) throw appError('自动保存记录不存在', 404);

  const autosavePath = trimText(autosave.storage_path);
  const autosaveStat = await readFileStatSafe(autosavePath);
  if (!autosaveStat?.isFile()) throw appError('自动保存文件不存在', 404);

  const restoredDraftPath = await copyToManagedPath(autosavePath, DRAFT_ROOT, '.docx');
  const restoredDraftStat = await readFileStatSafe(restoredDraftPath);

  const createSnapshot = req.body?.create_snapshot === undefined
    ? true
    : normalizeBoolean(req.body?.create_snapshot, true);

  let rollbackVersionRow = null;
  let rollbackVersionPath = '';
  if (createSnapshot) {
    rollbackVersionPath = await copyToManagedPath(restoredDraftPath, VERSION_ROOT, '.docx');
  }

  const result = await transaction(async (tx) => {
    let versionId = Number(bid.current_version_id || 0) || null;
    if (createSnapshot) {
      const nextVersionNo = await getNextVersionNo(tx, bidId);
      const insert = await tx.run(
        `INSERT INTO tender_bid_versions
          (bid_id, version_no, source_type, source_ext, storage_path, file_name, file_size, mime_type, created_by_id, created_by_name)
         VALUES (?, ?, 'rollback', 'docx', ?, ?, ?, ?, ?, ?)`,
        [
          bidId,
          nextVersionNo,
          rollbackVersionPath,
          `${trimText(bid.title) || 'tender'}-rollback-v${nextVersionNo}.docx`,
          Number((await readFileStatSafe(rollbackVersionPath))?.size || 0),
          guessMimeByExt('.docx'),
          Number(req.user.id),
          req.user.username,
        ]
      );
      versionId = Number(insert.insertId);
      rollbackVersionRow = await tx.get('SELECT * FROM tender_bid_versions WHERE id = ? LIMIT 1', [insert.insertId]);
      await tx.run(
        `UPDATE tender_bids
         SET current_version_id = ?, updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [versionId, Number(req.user.id), req.user.username, bidId]
      );
    }

    await tx.run(
      `UPDATE tender_bid_drafts
       SET draft_file_path = ?, draft_file_name = ?, base_version_id = ?, updated_by_id = ?, updated_by_name = ?, last_saved_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [
        restoredDraftPath,
        path.basename(restoredDraftPath),
        versionId,
        Number(req.user.id),
        req.user.username,
        Number(draft.id),
      ]
    );

    const afterDraft = await tx.get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [Number(draft.id)]);
    return sanitizeDraftRow(afterDraft);
  });

  await logOperation({
    req,
    action: 'DRAFT_ROLLBACK',
    entity: 'bid',
    entityId: bidId,
    message: `草稿回滚到自动保存记录 #${autosaveId}`,
    afterData: {
      autosave_id: autosaveId,
      draft_id: Number(draft.id),
      restored_size: Number(restoredDraftStat?.size || 0),
      version_id: Number(rollbackVersionRow?.id || 0) || null,
    },
  });

  res.json({
    ok: true,
    draft: result,
    version: rollbackVersionRow ? sanitizeVersionRow(rollbackVersionRow) : null,
  });
}));

app.post('/api/tender/bids/:id/versions/upload', requirePermission('tender:write'), uploadBidVersion, asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });

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
       SET current_version_id = ?,
           status = CASE
             WHEN status IN ('DRAFT', 'IN_REVIEW', 'FINALIZED') THEN 'FILES_UPLOADED'
             ELSE status
           END,
           review_status = CASE
             WHEN status IN ('DRAFT', 'IN_REVIEW', 'FINALIZED') THEN 'draft'
             ELSE review_status
           END,
           updated_by_id = ?, updated_by_name = ?, updated_at = NOW()
       WHERE id = ?`,
      [insert.insertId, Number(req.user.id), req.user.username, bidId]
    );

    return tx.get('SELECT * FROM tender_bid_versions WHERE id = ?', [insert.insertId]);
  });

  await run('DELETE FROM tender_bid_drafts WHERE bid_id = ?', [bidId]);
  await ensureDraftForBid({ bid: await ensureBidExists(bidId, { user: req.user }), user: req.user });

  await logOperation({
    req,
    action: 'VERSION_UPLOAD',
    entity: 'bid_version',
    entityId: Number(result.id),
    message: `上传标书版本 v${result.version_no}`,
    afterData: result,
  });

  res.status(201).json(sanitizeVersionRow(result));
}));

app.get('/api/tender/bids/:id/versions', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });
  const rows = await query(
    `SELECT *
     FROM tender_bid_versions
     WHERE bid_id = ?
     ORDER BY version_no DESC`,
    [bidId]
  );
  res.json(rows.map((row) => sanitizeVersionRow(row)));
}));

app.get('/api/tender/bids/:id/versions/compare', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const leftVersionId = Number(req.query.left_version_id || req.query.left || 0);
  const rightVersionId = Number(req.query.right_version_id || req.query.right || 0);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(leftVersionId) || leftVersionId <= 0) throw appError('左侧版本ID无效', 400);
  if (!Number.isFinite(rightVersionId) || rightVersionId <= 0) throw appError('右侧版本ID无效', 400);
  if (leftVersionId === rightVersionId) throw appError('请至少选择两个不同版本进行对比', 400);

  await ensureBidExists(bidId, { user: req.user });
  const [leftVersion, rightVersion] = await Promise.all([
    getBidVersionById({ bidId, versionId: leftVersionId }),
    getBidVersionById({ bidId, versionId: rightVersionId }),
  ]);
  if (!leftVersion || !rightVersion) throw appError('版本不存在或不属于当前标书', 404);

  const [leftText, rightText] = await Promise.all([
    resolveBidVersionSearchText(leftVersion),
    resolveBidVersionSearchText(rightVersion),
  ]);

  if (!leftText && !rightText) {
    return res.json({
      left_version: sanitizeVersionRow(leftVersion),
      right_version: sanitizeVersionRow(rightVersion),
      comparable: false,
      reason: '两个版本都缺少可提取文本，暂不支持对比',
      summary: null,
      entries: [],
    });
  }

  const diffPayload = buildVersionDiffResult({ leftText, rightText });
  return res.json({
    left_version: sanitizeVersionRow(leftVersion),
    right_version: sanitizeVersionRow(rightVersion),
    comparable: true,
    ...diffPayload,
  });
}));

app.post('/api/tender/bids/:id/versions/snapshot', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  const bid = await ensureBidExists(bidId, { user: req.user });
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

  res.status(201).json(sanitizeVersionRow(result));
}));

app.post('/api/tender/bids/:id/editor/session', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
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

  await insertOperationLog({
    userId: req.user.id,
    username: req.user.username,
    userRole: req.user.role,
    action: 'EDITOR_JOIN',
    entity: 'bid',
    entityId: bidId,
    message: '加入协同编辑',
    afterData: {
      bid_id: bidId,
      session_key: sessionKey,
      draft_id: draft.id,
    },
    requestIp: getClientIp(req),
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
  await ensureBidExists(bidId, { user: req.user });

  const activeSessions = await query(
    `SELECT id, session_key, draft_id
     FROM tender_editor_sessions
     WHERE bid_id = ? AND user_id = ? AND status = 'active'
     ORDER BY id DESC`,
    [bidId, Number(req.user.id)]
  );

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

  for (const item of activeSessions) {
    await insertOperationLog({
      userId: req.user.id,
      username: req.user.username,
      userRole: req.user.role,
      action: 'EDITOR_LEAVE',
      entity: 'bid',
      entityId: bidId,
      message: '离开协同编辑',
      afterData: {
        bid_id: bidId,
        session_key: trimText(item.session_key),
        draft_id: Number(item.draft_id) || null,
      },
      requestIp: getClientIp(req),
    });
  }

  res.json({ ok: true });
}));

app.get('/api/tender/bids/:id/editor/events', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  await ensureBidExists(bidId, { user: req.user });

  const limit = Math.min(EDITOR_EVENTS_MAX_LIMIT, toBoundedLimit(req.query.limit, 80));
  const rows = await query(
    `SELECT id, username, user_role, action, message, after_data, request_ip, created_at
     FROM tender_operation_logs
     WHERE entity = 'bid'
       AND entity_id = ?
       AND action IN ('EDITOR_JOIN', 'EDITOR_SAVE', 'EDITOR_FORCE_SAVE', 'EDITOR_LEAVE')
     ORDER BY id DESC
     LIMIT ?`,
    [bidId, limit]
  );

  const items = rows.map((row) => {
    const payload = parseMaybeJson(row.after_data, {});
    return {
      id: Number(row.id),
      username: trimText(row.username) || '-',
      user_role: trimText(row.user_role),
      action: trimText(row.action),
      message: trimText(row.message),
      request_ip: trimText(row.request_ip),
      created_at: row.created_at,
      session_key: trimText(payload?.session_key),
      draft_id: Number(payload?.draft_id || 0) || null,
      onlyoffice_status: Number(payload?.onlyoffice_status || 0) || null,
      file_size: Number(payload?.file_size || 0) || null,
      file_hash: trimText(payload?.file_hash),
    };
  });

  res.json({
    items,
    total: items.length,
  });
}));

app.get('/api/tender/risk-center/summary', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const keyword = trimText(req.query.keyword);
  const status = normalizeStatus(req.query.status);
  const level = trimText(req.query.level).toUpperCase();
  const limit = toBoundedLimit(req.query.limit, 200);
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
  appendScopedWhere(where, params, buildBidScopeWhere(req.user, {
    idColumn: 'tender_bids.id',
    creatorColumn: 'tender_bids.created_by_id',
  }));

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const bidRows = await query(
    `SELECT *
     FROM tender_bids
     ${whereSql}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );

  const riskRows = await buildRiskCenterProjectRows(bidRows);
  const filteredRows = riskRows.filter((item) => !level || String(item.risk_level || '').toUpperCase() === level);

  res.json({
    overview: buildRiskCenterOverview(filteredRows),
    items: filteredRows,
  });
}));

app.get('/api/tender/export-center/summary', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const keyword = trimText(req.query.keyword);
  const status = normalizeStatus(req.query.status);
  const limit = toBoundedLimit(req.query.limit, 200);
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
  appendScopedWhere(where, params, buildBidScopeWhere(req.user, {
    idColumn: 'tender_bids.id',
    creatorColumn: 'tender_bids.created_by_id',
  }));

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const bidRows = await query(
    `SELECT *
     FROM tender_bids
     ${whereSql}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );

  const { projectRows, exportRecords } = await buildExportCenterProjectRows(bidRows);
  const visibleBidIds = new Set(projectRows.map((item) => Number(item.bid_id)).filter((item) => Number.isFinite(item) && item > 0));
  const visibleRecords = exportRecords.filter((item) => visibleBidIds.has(Number(item.bid_id))).slice(0, 80);

  res.json({
    overview: buildExportCenterOverview({ projectRows, exportRecords: visibleRecords, now: new Date().toISOString() }),
    items: projectRows,
    recent_records: visibleRecords,
  });
}));

app.post('/api/tender/bids/:id/export', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const format = trimText(req.body?.format).toUpperCase() || 'DOCX';
  const record = await executeBidExport({ bid, format, user: req.user });
  const latestBid = await ensureBidExists(bidId, { user: req.user });

  await logOperation({
    req,
    action: 'BID_EXPORT',
    entity: 'bid',
    entityId: bidId,
    message: `导出标书 ${bid.bid_no} (${format})`,
    afterData: {
      export_record_id: Number(record.id),
      export_type: record.export_type,
      status: record.status,
      file_name: record.file_name,
    },
  });

  res.status(201).json({
    ok: true,
    bid: latestBid,
    record,
    download_url: `/api/tender/export-records/${record.id}/download`,
  });
}));

app.get('/api/tender/export-records/:id/download', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const recordId = Number(req.params.id);
  if (!Number.isFinite(recordId) || recordId <= 0) throw appError('导出记录ID无效', 400);

  const row = await get('SELECT * FROM tender_bid_export_records WHERE id = ? LIMIT 1', [recordId]);
  if (!row) throw appError('导出记录不存在', 404);
  const record = sanitizeExportRecordRow(row);
  await ensureBidExists(Number(record.bid_id), { user: req.user });
  if (record.status !== 'SUCCESS' || !trimText(record.storage_path)) throw appError('当前导出记录无可下载文件', 404);

  const stat = await readFileStatSafe(record.storage_path);
  if (!stat?.isFile()) throw appError('导出文件不存在', 404);

  res.setHeader('Content-Type', record.mime_type || guessMimeByExt(path.extname(record.file_name || record.storage_path)));
  res.download(path.resolve(record.storage_path), record.file_name || path.basename(record.storage_path));
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

  const draft = sanitizeDraftRow(await get('SELECT * FROM tender_bid_drafts WHERE id = ? LIMIT 1', [draftId]));
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
      const autosavePath = await copyToManagedPath(draft.draft_file_path, DRAFT_ROOT, '.docx');
      await run(
        `INSERT INTO tender_bid_draft_autosaves
          (bid_id, draft_id, version_id, storage_path, file_name, file_size, source, content_hash, saved_by_id, saved_by_name, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ONLYOFFICE', ?, ?, ?, NOW())`,
        [
          Number(session.bid_id) || null,
          Number(draft.id),
          Number(session.version_id) || null,
          autosavePath,
          path.basename(autosavePath),
          Number(fileBuf.length || 0),
          crypto.createHash('sha256').update(fileBuf).digest('hex'),
          Number(session.user_id) || null,
          session.username,
        ]
      );
      await insertOperationLog({
        userId: Number(session.user_id) || null,
        username: session.username,
        userRole: 'editor',
        action: status === 6 ? 'EDITOR_FORCE_SAVE' : 'EDITOR_SAVE',
        entity: 'bid',
        entityId: Number(session.bid_id) || null,
        message: status === 6 ? '协同强制保存草稿' : '协同保存草稿',
        afterData: {
          bid_id: Number(session.bid_id) || null,
          session_key: sessionKey,
          draft_id: Number(draft.id),
          onlyoffice_status: status,
          file_size: Number(fileBuf.length || 0),
          file_hash: crypto.createHash('sha256').update(fileBuf).digest('hex'),
        },
        requestIp: getClientIp(req),
      });
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
  const bundleRefs = await query(
    `SELECT b.id, b.bundle_code, b.name
     FROM tender_template_bundle_items item
     INNER JOIN tender_template_bundles b ON b.id = item.bundle_id
     WHERE item.item_type = 'FIELD' AND item.ref_id = ?
     ORDER BY b.id DESC`,
    [id]
  );
  if (bundleRefs.length) {
    throw appError(buildTemplateReferenceConflictMessage({
      entityLabel: '模板字段',
      entityCode: before.field_code,
      bundles: bundleRefs,
    }), 400);
  }

  await run('DELETE FROM tender_template_fields WHERE id = ?', [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_FIELD_DELETE',
    entity: 'template_field',
    entityId: id,
    message: `删除模板字段 ${before.field_code}`,
    beforeData: before,
    afterData: { deleted: true },
  });

  res.json({ ok: true, id });
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
  const bundleRefs = await query(
    `SELECT b.id, b.bundle_code, b.name
     FROM tender_template_bundle_items item
     INNER JOIN tender_template_bundles b ON b.id = item.bundle_id
     WHERE item.item_type = 'SNIPPET' AND item.ref_id = ?
     ORDER BY b.id DESC`,
    [id]
  );
  if (bundleRefs.length) {
    throw appError(buildTemplateReferenceConflictMessage({
      entityLabel: '模板片段',
      entityCode: before.snippet_code,
      bundles: bundleRefs,
    }), 400);
  }

  await run('DELETE FROM tender_template_snippets WHERE id = ?', [id]);

  await logOperation({
    req,
    action: 'TEMPLATE_SNIPPET_DELETE',
    entity: 'template_snippet',
    entityId: id,
    message: `删除模板片段 ${before.snippet_code}`,
    beforeData: before,
    afterData: { deleted: true },
  });

  res.json({ ok: true, id });
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
  await transaction(async (tx) => {
    await tx.run('DELETE FROM tender_template_bundle_items WHERE bundle_id = ?', [id]);
    await tx.run('DELETE FROM tender_template_bundles WHERE id = ?', [id]);
  });

  await logOperation({
    req,
    action: 'TEMPLATE_BUNDLE_DELETE',
    entity: 'template_bundle',
    entityId: id,
    message: `删除模板包 ${before.bundle_code}`,
    beforeData: before,
    afterData: { deleted: true },
  });

  res.json({ ok: true, id });
}));

app.post('/api/tender/bids/:id/fill', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.params.id);
  const bundleId = Number(req.body?.bundle_id);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('标书ID无效', 400);
  if (!Number.isFinite(bundleId) || bundleId <= 0) throw appError('bundle_id无效', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
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
    await ensureBidExists(bidId, { user: req.user });
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

  const asset = sanitizeAssetRow(await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [assetInfo.insertId]));

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
    await ensureBidExists(bidId, { user: req.user });
    where.push('a.bid_id = ?');
    params.push(bidId);
  } else {
    appendScopedWhere(where, params, buildOwnerScopeWhere(req.user, 'a.uploaded_by_id'));
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
      ...sanitizeAssetRow(row),
      fields_json: parseMaybeJson(row.fields_json, {}),
    }))
  );
}));

app.delete('/api/tender/assets/:id', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('资产ID无效', 400);

  const asset = sanitizeAssetRow(await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]));
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

  const asset = sanitizeAssetRow(await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]));
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

  const asset = sanitizeAssetRow(await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]));
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

  const asset = sanitizeAssetRow(await get('SELECT * FROM tender_assets WHERE id = ? LIMIT 1', [id]));
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

app.post('/api/tender/ai/models/test', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const prepared = await buildModelRuntimeForTest(req.body || {});
  const result = await runAiModelConnectionTest({
    req,
    modelMeta: prepared.modelMeta,
    runtime: prepared.runtime,
    source: prepared.source,
  });
  res.json(result);
}));

app.post('/api/tender/ai/models/:id/test', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模型ID无效', 400);

  const body = { ...(req.body || {}), model_id: id };
  const prepared = await buildModelRuntimeForTest(body);
  const result = await runAiModelConnectionTest({
    req,
    modelMeta: { ...prepared.modelMeta, id },
    runtime: prepared.runtime,
    source: 'saved',
  });
  res.json(result);
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

app.delete('/api/tender/ai/models/:id', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) throw appError('模型ID无效', 400);

  const before = await get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1', [id]);
  if (!before) throw appError('模型不存在', 404);

  let switchedDefaultId = null;
  await transaction(async (tx) => {
    const countRow = await tx.get('SELECT COUNT(1) AS count FROM tender_ai_models');
    if (Number(countRow?.count || 0) <= 1) {
      throw appError('至少保留一个模型，不能全部删除', 400);
    }

    const model = await tx.get('SELECT * FROM tender_ai_models WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!model) throw appError('模型不存在', 404);

    if (Number(model.is_default || 0) === 1) {
      const candidate = await tx.get(
        'SELECT id FROM tender_ai_models WHERE id <> ? AND is_enabled = 1 ORDER BY id ASC LIMIT 1',
        [id]
      );
      if (!candidate) {
        throw appError('当前默认模型不能删除，请先启用并设置其他默认模型', 400);
      }
      switchedDefaultId = Number(candidate.id);
    }

    await tx.run('DELETE FROM tender_ai_models WHERE id = ?', [id]);

    if (switchedDefaultId) {
      await tx.run('UPDATE tender_ai_models SET is_default = 0 WHERE is_default = 1');
      await tx.run('UPDATE tender_ai_models SET is_default = 1 WHERE id = ?', [switchedDefaultId]);
      return;
    }

    const hasDefault = await tx.get('SELECT id FROM tender_ai_models WHERE is_default = 1 LIMIT 1');
    if (hasDefault) return;
    const fallback = await tx.get('SELECT id FROM tender_ai_models WHERE is_enabled = 1 ORDER BY id ASC LIMIT 1');
    if (fallback) {
      switchedDefaultId = Number(fallback.id);
      await tx.run('UPDATE tender_ai_models SET is_default = 1 WHERE id = ?', [switchedDefaultId]);
    }
  });

  await logOperation({
    req,
    action: 'AI_MODEL_DELETE',
    entity: 'ai_model',
    entityId: id,
    message: switchedDefaultId
      ? `删除模型 ${before.model_key}，默认模型切换为ID=${switchedDefaultId}`
      : `删除模型 ${before.model_key}`,
    beforeData: { ...before, api_key_enc: SECRET_MASK },
    afterData: switchedDefaultId ? { switched_default_model_id: switchedDefaultId } : {},
  });

  res.json({
    ok: true,
    switched_default_model_id: switchedDefaultId,
  });
}));

app.get('/api/tender/ai/prompts', requirePermission('tender:ai:manage'), asyncHandler(async (_req, res) => {
  const rows = await query('SELECT * FROM tender_ai_prompts ORDER BY id ASC');
  res.json(rows);
}));

app.put('/api/tender/ai/prompts/:taskType', requirePermission('tender:ai:manage'), asyncHandler(async (req, res) => {
  const taskType = trimText(req.params.taskType).toUpperCase();
  if (![
    'OCR_STRUCTURED',
    'REWRITE',
    'PROOFREAD',
    'BID_ANALYZE_STAGE1',
    'BID_ANALYZE_STAGE2',
    'BID_ANALYZE_STAGE3',
    'BID_ANALYZE',
    'BID_COMPOSE_DRAFT',
  ].includes(taskType)) {
    throw appError('不支持的任务类型', 400);
  }
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

app.get('/api/tender/evaluations/overview', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const datasetRows = await listVisibleEvaluationDatasets({ user: req.user, limit: 2000 });
  const runRows = await listVisibleEvaluationRuns({ user: req.user, limit: 2000 });
  const latestRun = runRows[0] || null;
  const latestBaselineRun = runRows.find((item) => String(item.run_scope) === 'BASELINE') || null;

  res.json({
    overview: {
      dataset_count: datasetRows.length,
      baseline_dataset_count: datasetRows.filter((item) => item.baseline_flag).length,
      run_count: runRows.length,
      latest_run: latestRun,
      latest_baseline_run: latestBaselineRun,
    },
    dataset_counts_by_type: TENDER_EVAL_TYPES.map((evalType) => ({
      eval_type: evalType,
      count: datasetRows.filter((item) => item.eval_type === evalType).length,
    })),
    recent_runs: runRows.slice(0, 10),
  });
}));

app.get('/api/tender/evaluations/datasets', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const limit = toBoundedLimit(req.query.limit, 200);
  const items = await listVisibleEvaluationDatasets({
    user: req.user,
    filters: {
      evalType: req.query.eval_type,
      baselineFlag: req.query.baseline_flag,
      status: req.query.status,
    },
    limit,
  });
  res.json({
    items,
    total: items.length,
  });
}));

app.post('/api/tender/evaluations/datasets', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const bidId = Number(req.body?.bid_id || req.body?.source_bid_id || 0);
  if (!Number.isFinite(bidId) || bidId <= 0) throw appError('bid_id不能为空', 400);

  const evalType = normalizeEvaluationType(req.body?.eval_type);
  if (!evalType) throw appError('eval_type不支持', 400);

  const bid = await ensureBidExists(bidId, { user: req.user });
  const facts = await buildEvaluationFactBundle({ bid });
  const actualPayload = buildEvaluationActualPayload({ evalType, facts });
  const expectedPayload = req.body?.expected_payload === undefined
    ? buildEvaluationExpectedPayloadFromFacts({ evalType, facts })
    : normalizeEvaluationExpectedPayload(
      evalType,
      req.body?.expected_payload && typeof req.body.expected_payload === 'object'
        ? req.body.expected_payload
        : parseMaybeJson(req.body?.expected_payload, {})
    );

  const datasetName = trimText(req.body?.dataset_name) || `${trimText(bid.project_name || bid.title)}-${evalType}`;
  const datasetCode = trimText(req.body?.dataset_code) || buildEvaluationDatasetCode();
  const baselineFlag = req.body?.baseline_flag === undefined ? 1 : (req.body?.baseline_flag ? 1 : 0);
  const notes = trimText(req.body?.notes);

  const insert = await run(
    `INSERT INTO tender_eval_datasets
      (dataset_code, dataset_name, eval_type, source_bid_id, baseline_flag, status, expected_payload_json, notes, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
    [
      datasetCode,
      datasetName,
      evalType,
      bidId,
      baselineFlag,
      JSON.stringify(expectedPayload),
      notes || null,
      Number(req.user.id),
      req.user.username,
      Number(req.user.id),
      req.user.username,
    ]
  );

  const row = sanitizeEvaluationDatasetRow(await get('SELECT * FROM tender_eval_datasets WHERE id = ? LIMIT 1', [insert.insertId]));

  await logOperation({
    req,
    action: 'EVALUATION_DATASET_CREATE',
    entity: 'evaluation_dataset',
    entityId: Number(row.id),
    message: `创建评测数据集 ${row.dataset_code}`,
    afterData: {
      eval_type: row.eval_type,
      source_bid_id: row.source_bid_id,
      baseline_flag: row.baseline_flag,
    },
  });

  res.status(201).json({
    ...row,
    actual_preview: actualPayload,
  });
}));

app.get('/api/tender/evaluations/runs', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const limit = toBoundedLimit(req.query.limit, 100);
  const items = await listVisibleEvaluationRuns({ user: req.user, limit });
  res.json({
    items,
    total: items.length,
  });
}));

app.get('/api/tender/evaluations/runs/:id', requirePermission('tender:read'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id);
  if (!Number.isFinite(runId) || runId <= 0) throw appError('评测批次ID无效', 400);

  const detail = await loadVisibleEvaluationRunDetail({ user: req.user, runId });
  if (!detail) throw appError('评测批次不存在', 404);
  res.json(detail);
}));

app.post('/api/tender/evaluations/runs', requirePermission('tender:write'), asyncHandler(async (req, res) => {
  const requestedIds = Array.from(
    new Set(
      (Array.isArray(req.body?.dataset_ids) ? req.body.dataset_ids : [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
  const runScope = ['BASELINE', 'ADHOC'].includes(trimText(req.body?.run_scope).toUpperCase())
    ? trimText(req.body?.run_scope).toUpperCase()
    : 'ADHOC';
  const runLabel = trimText(req.body?.run_label) || `${runScope === 'BASELINE' ? 'Baseline' : 'Adhoc'} ${new Date().toISOString()}`;

  const datasets = requestedIds.length
    ? await listVisibleEvaluationDatasets({ user: req.user, filters: { datasetIds: requestedIds, status: 'ACTIVE' }, limit: requestedIds.length })
    : await listVisibleEvaluationDatasets({ user: req.user, filters: { baselineFlag: true, status: 'ACTIVE' }, limit: 500 });

  if (requestedIds.length && datasets.length !== requestedIds.length) {
    throw appError('部分评测数据集不存在或无权限', 404);
  }
  if (!datasets.length) {
    throw appError('缺少可执行的评测数据集', 409);
  }

  const previousBaselineRun = await loadLatestBaselineRun();
  const evaluatedItems = [];
  for (const dataset of datasets) {
    const bid = await ensureBidExists(Number(dataset.source_bid_id), { user: req.user });
    const facts = await buildEvaluationFactBundle({ bid });
    const actualPayload = buildEvaluationActualPayload({ evalType: dataset.eval_type, facts });
    const result = evaluateDatasetResult({
      dataset,
      actual: actualPayload,
    });
    evaluatedItems.push({
      dataset,
      actual: actualPayload,
      result,
    });
  }

  const summary = buildRunSummary(evaluatedItems.map((item) => item.result));
  const baselineSummary = buildBaselineDelta({
    currentSummary: summary,
    baselineSummary: previousBaselineRun?.summary || summary,
  });
  const runStatus = determineEvaluationRunStatus(summary);

  const created = await transaction(async (tx) => {
    const insert = await tx.run(
      `INSERT INTO tender_eval_runs
        (run_no, run_label, run_scope, status, dataset_count, summary_json, baseline_summary_json, started_by_id, started_by_name, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        buildEvaluationRunNo(),
        runLabel,
        runScope,
        runStatus,
        evaluatedItems.length,
        JSON.stringify(summary),
        JSON.stringify(baselineSummary),
        Number(req.user.id),
        req.user.username,
      ]
    );
    const runId = Number(insert.insertId);

    for (const item of evaluatedItems) {
      const summaryKey = evaluationTypeToSummaryKey(item.dataset.eval_type);
      const deltaPayload = summaryKey && baselineSummary?.kpis?.[summaryKey]
        ? baselineSummary.kpis[summaryKey]
        : { current_score: Number(item.result.score || 0), baseline_score: Number(item.result.score || 0), delta: 0, trend: 'FLAT' };
      await tx.run(
        `INSERT INTO tender_eval_run_items
          (run_id, dataset_id, eval_type, source_bid_id, score, status, result_json, delta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          Number(item.dataset.id),
          item.dataset.eval_type,
          Number(item.dataset.source_bid_id),
          Number(item.result.score || 0),
          item.result.status,
          JSON.stringify(item.result),
          JSON.stringify(deltaPayload),
        ]
      );
    }

    return runId;
  });

  const detail = await loadVisibleEvaluationRunDetail({ user: req.user, runId: created });

  await logOperation({
    req,
    action: 'EVALUATION_RUN_START',
    entity: 'evaluation_run',
    entityId: Number(created),
    message: `执行评测批次 ${runLabel}`,
    afterData: {
      run_scope: runScope,
      dataset_count: evaluatedItems.length,
      status: runStatus,
      overall_score: summary.overall_score,
    },
  });

  res.status(201).json(detail);
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

app.use((err, req, res, _next) => {
  const {
    status,
    payload,
    should_log: shouldLogFailure,
    failure_log: failureLog,
  } = buildFailurePayload({
    err,
    path: req?.path,
    method: req?.method,
  });
  if (shouldLogFailure) {
    insertOperationLog({
      userId: req?.user?.id,
      username: req?.user?.username,
      userRole: req?.user?.role,
      action: failureLog.action,
      entity: failureLog.entity,
      entityId: null,
      message: failureLog.message,
      beforeData: null,
      afterData: failureLog.afterData,
      requestIp: getClientIp(req),
    }).catch((logErr) => {
      console.error('[tender] failure audit log write failed:', logErr?.message || logErr);
    });
  }
  if (!res.headersSent) {
    res.status(status).json(payload);
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

if (require.main === module) {
  start().catch((err) => {
    console.error('[tender] failed to start:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
};

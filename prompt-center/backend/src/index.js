require('dotenv').config();

const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const db = require('./db');
const {
  appError,
  asyncHandler,
  authRequired,
  canManageTaxonomy,
  canPublishPrompt,
  canReadAudit,
  canWritePrompt,
  requirePermission,
} = require('./auth');
const service = require('./prompt-service');

const app = express();
const PORT = Number(process.env.PORT || 5189);
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true,
}));

const requestIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'prompt-center' });
});

const router = express.Router();
router.use(authRequired);

router.get('/auth/me', (req, res) => {
  res.json({
    user: req.user,
    permissions: {
      can_write: canWritePrompt(req),
      can_publish: canPublishPrompt(req),
      can_manage_taxonomy: canManageTaxonomy(req),
      can_read_audit: canReadAudit(req),
    },
  });
});

router.get('/overview', asyncHandler(async (_req, res) => {
  res.json(await service.getOverview(db));
}));

router.get('/departments', asyncHandler(async (req, res) => {
  res.json(await service.listDepartments(db, { includeInactive: req.query.include_inactive === '1' }));
}));

router.post('/departments', requirePermission(canManageTaxonomy, '仅管理员或业务管理员可维护部门'), asyncHandler(async (req, res) => {
  res.status(201).json(await service.saveDepartment(db, req.body, req.user, requestIp(req)));
}));

router.put('/departments/:id', requirePermission(canManageTaxonomy, '仅管理员或业务管理员可维护部门'), asyncHandler(async (req, res) => {
  res.json(await service.saveDepartment(db, req.body, req.user, requestIp(req), req.params.id));
}));

router.get('/categories', asyncHandler(async (req, res) => {
  res.json(await service.listCategories(db, req.query));
}));

router.post('/categories', requirePermission(canManageTaxonomy, '仅管理员或业务管理员可维护分类'), asyncHandler(async (req, res) => {
  res.status(201).json(await service.saveCategory(db, req.body, req.user, requestIp(req)));
}));

router.put('/categories/:id', requirePermission(canManageTaxonomy, '仅管理员或业务管理员可维护分类'), asyncHandler(async (req, res) => {
  res.json(await service.saveCategory(db, req.body, req.user, requestIp(req), req.params.id));
}));

router.get('/prompts', asyncHandler(async (req, res) => {
  res.json(await service.listPrompts(db, req.query, req));
}));

router.post('/prompts', requirePermission(canWritePrompt, '仅管理员或业务管理员可维护提示词'), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createPrompt(db, req.body, req.user, requestIp(req)));
}));

router.get('/prompts/:id', asyncHandler(async (req, res) => {
  res.json(await service.getPromptById(db, req.params.id, req));
}));

router.put('/prompts/:id', requirePermission(canWritePrompt, '仅管理员或业务管理员可维护提示词'), asyncHandler(async (req, res) => {
  res.json(await service.updatePrompt(db, req.params.id, req.body, req.user, requestIp(req)));
}));

router.post('/prompts/:id/publish', requirePermission(canPublishPrompt, '仅管理员或审核用户可发布提示词'), asyncHandler(async (req, res) => {
  res.json(await service.setPromptStatus(db, req.params.id, 'published', req.user, requestIp(req)));
}));

router.post('/prompts/:id/archive', requirePermission(canPublishPrompt, '仅管理员或审核用户可归档提示词'), asyncHandler(async (req, res) => {
  res.json(await service.setPromptStatus(db, req.params.id, 'archived', req.user, requestIp(req)));
}));

router.post('/prompts/:id/usage', asyncHandler(async (req, res) => {
  res.json(await service.recordUsage(db, req.params.id, req.user, requestIp(req)));
}));

router.get('/prompts/:id/versions', requirePermission(canWritePrompt, '仅管理员或业务管理员可查看版本记录'), asyncHandler(async (req, res) => {
  await service.getPromptById(db, req.params.id, { user: { role: 'admin' } });
  res.json(await service.listVersions(db, req.params.id));
}));

router.post('/prompts/:id/rollback', requirePermission(canWritePrompt, '仅管理员或业务管理员可回滚提示词'), asyncHandler(async (req, res) => {
  const versionId = Number(req.body?.version_id || req.body?.versionId || 0);
  if (!versionId) throw appError('请选择要回滚的版本', 400);
  res.json(await service.rollbackPrompt(db, req.params.id, versionId, req.user, requestIp(req)));
}));

router.get('/audit/logs', requirePermission(canReadAudit, '仅管理员或审计管理员可查看审计日志'), asyncHandler(async (req, res) => {
  res.json(await service.listAuditLogs(db, req.query));
}));

app.use('/api/prompt-center', router);

app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode || 500);
  if (status >= 500) console.error('[prompt-center] internal error:', err);
  res.status(status).json({ error: err?.message || '请求失败' });
});

if (require.main === module) {
  db.initDb()
    .then(() => {
      app.listen(PORT, () => console.log(`[prompt-center] api listening on :${PORT}`));
    })
    .catch((err) => {
      console.error('[prompt-center] startup failed:', err);
      process.exit(1);
    });
}

module.exports = app;

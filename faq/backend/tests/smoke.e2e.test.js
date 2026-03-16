const {
  getApiBase,
  getAuthBase,
  request,
  ensureStatus,
  ensureJsonField,
  uniqueCode,
  loginByPassword,
} = require('./helpers/api');

const LEGACY_BUILTIN_PASSWORD = 'Dm1vbnqsILIVjUa5sWixBFos60bKdEKC';

const normalizeText = (value) => String(value || '').trim();
const uniqueNonEmpty = (items = []) => Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));
const maskSecret = (value) => {
  const text = normalizeText(value);
  if (!text) return '<empty>';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
};

const buildPasswordCandidates = (passwordEnvKeys = []) =>
  uniqueNonEmpty([
    ...passwordEnvKeys.map((key) => process.env[key]),
    process.env.BUILTIN_ACCOUNT_DEFAULT_PASSWORD,
    process.env.BUILTIN_PASSWORD,
    '123456',
    LEGACY_BUILTIN_PASSWORD,
  ]);

const resolveTokenByCandidates = async ({
  authBase,
  apiBase = '',
  tokenEnvKeys = [],
  loginEnvKeys = [],
  loginDefaults = [],
  passwordEnvKeys = [],
  label = '账号',
  optional = false,
  tokenVerifier = null,
}) => {
  const verify = async (token, sourceLabel) => {
    if (!tokenVerifier) return { ok: true, reason: '' };
    try {
      return await tokenVerifier({ token, apiBase, sourceLabel });
    } catch (err) {
      return { ok: false, reason: String(err?.message || 'token check failed').slice(0, 160) };
    }
  };

  const failures = [];

  for (const key of tokenEnvKeys) {
    const directToken = normalizeText(process.env[key]);
    if (!directToken) continue;
    const checked = await verify(directToken, `env:${key}`);
    if (checked.ok) return directToken;
    failures.push(`env:${key} -> ${checked.reason || 'token rejected'}`);
  }

  const loginIds = uniqueNonEmpty([
    ...loginEnvKeys.map((key) => process.env[key]),
    ...loginDefaults,
  ]);
  const passwords = buildPasswordCandidates(passwordEnvKeys);

  for (const loginId of loginIds) {
    for (const password of passwords) {
      try {
        const token = await loginByPassword({ authBase, loginId, password });
        const checked = await verify(token, `${loginId}/${maskSecret(password)}`);
        if (checked.ok) return token;
        failures.push(`${loginId}/${maskSecret(password)} -> ${checked.reason || 'token rejected'}`);
      } catch (err) {
        failures.push(`${loginId}/${maskSecret(password)} -> ${String(err?.message || '').slice(0, 120)}`);
      }
    }
  }

  if (optional) return '';
  const detail = failures.slice(-6).join(' | ');
  throw new Error(`${label}登录失败，已尝试 ${loginIds.length} 个账号与 ${passwords.length} 个密码候选。${detail}`);
};

const resolveSessionInfo = async ({ apiBase, token }) => {
  if (!normalizeText(token)) return { ok: false, status: 401, role: '', permissions: {}, reason: 'token empty' };
  const meResp = await request({
    base: apiBase,
    path: '/api/auth/me',
    method: 'GET',
    token,
  });
  if (meResp.status !== 200) {
    return {
      ok: false,
      status: Number(meResp.status || 0),
      role: '',
      permissions: {},
      reason: normalizeText(meResp.json?.error || meResp.text || ''),
    };
  }
  return {
    ok: true,
    status: 200,
    role: normalizeText(meResp.json?.role).toLowerCase(),
    permissions: meResp.json?.permissions || {},
    reason: '',
  };
};

const resolveWriterToken = async ({ authBase, apiBase, optional = false }) =>
  resolveTokenByCandidates({
    authBase,
    apiBase,
    tokenEnvKeys: ['AUTH_TOKEN', 'WRITER_TOKEN', 'ADMIN_TOKEN', 'EDITOR_TOKEN'],
    loginEnvKeys: ['WRITER_LOGIN', 'WRITER_USERNAME', 'ADMIN_LOGIN', 'ADMIN_USERNAME', 'EDITOR_LOGIN', 'EDITOR_USERNAME'],
    loginDefaults: ['admin', 'editor'],
    passwordEnvKeys: ['WRITER_PASSWORD', 'ADMIN_PASSWORD', 'EDITOR_PASSWORD'],
    label: '写入账号',
    optional,
    tokenVerifier: async ({ token }) => {
      const info = await resolveSessionInfo({ apiBase, token });
      if (!info.ok) return { ok: false, reason: `FAQ访问失败(${info.status}) ${info.reason || ''}`.trim() };
      if (!info.permissions?.can_write_faq) return { ok: false, reason: 'can_write_faq=false' };
      return { ok: true, reason: '' };
    },
  });

const resolveAdminToken = async ({ authBase, apiBase, optional = false }) =>
  resolveTokenByCandidates({
    authBase,
    apiBase,
    tokenEnvKeys: ['ADMIN_TOKEN'],
    loginEnvKeys: ['ADMIN_LOGIN', 'ADMIN_USERNAME'],
    loginDefaults: ['admin'],
    passwordEnvKeys: ['ADMIN_PASSWORD'],
    label: '管理员账号',
    optional,
    tokenVerifier: async ({ token }) => {
      const info = await resolveSessionInfo({ apiBase, token });
      if (!info.ok) return { ok: false, reason: `FAQ访问失败(${info.status}) ${info.reason || ''}`.trim() };
      return { ok: info.role === 'admin', reason: info.role ? `role=${info.role}` : 'role unknown' };
    },
  });

const resolveReviewerToken = async ({ authBase, apiBase, optional = false }) =>
  resolveTokenByCandidates({
    authBase,
    apiBase,
    tokenEnvKeys: ['REVIEWER_TOKEN'],
    loginEnvKeys: ['REVIEWER_LOGIN', 'REVIEWER_USERNAME', 'ADMIN_LOGIN', 'ADMIN_USERNAME'],
    loginDefaults: ['reviewer', 'admin'],
    passwordEnvKeys: ['REVIEWER_PASSWORD', 'ADMIN_PASSWORD'],
    label: '审核账号',
    optional,
    tokenVerifier: async ({ token }) => {
      const info = await resolveSessionInfo({ apiBase, token });
      if (!info.ok) return { ok: false, reason: `FAQ访问失败(${info.status}) ${info.reason || ''}`.trim() };
      if (!info.permissions?.can_review_publish) return { ok: false, reason: 'can_review_publish=false' };
      return { ok: true, reason: '' };
    },
  });

const resolveAuditorToken = async ({ authBase, apiBase, optional = false }) =>
  resolveTokenByCandidates({
    authBase,
    apiBase,
    tokenEnvKeys: ['AUDITOR_TOKEN'],
    loginEnvKeys: ['AUDITOR_LOGIN', 'AUDITOR_USERNAME'],
    loginDefaults: ['auditor'],
    passwordEnvKeys: ['AUDITOR_PASSWORD'],
    label: '审计账号',
    optional,
    tokenVerifier: async ({ token }) => {
      const info = await resolveSessionInfo({ apiBase, token });
      if (!info.ok) return { ok: false, reason: `FAQ访问失败(${info.status}) ${info.reason || ''}`.trim() };
      if (!info.permissions?.can_view_audit) return { ok: false, reason: 'can_view_audit=false' };
      return { ok: true, reason: '' };
    },
  });

describe('faq smoke e2e', () => {
  const apiBase = getApiBase();
  const authBase = getAuthBase();

  it('should force delete category tree and recycle linked faq articles', async () => {
    const adminToken = await resolveAdminToken({ authBase, apiBase, optional: true });
    if (!adminToken) {
      console.warn('[faq smoke] skip: no FAQ admin token could be resolved');
      return;
    }
    const adminInfo = await resolveSessionInfo({ apiBase, token: adminToken });
    if (!adminInfo.ok || adminInfo.role !== 'admin') {
      console.warn(`[faq smoke] skip: admin token unavailable for FAQ admin force delete (${adminInfo.status} ${adminInfo.reason || ''})`);
      return;
    }

    const categoryPrefix = uniqueCode('FAQ-CATEGORY-FORCE');

    const parentResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: adminToken,
      body: {
        name: `${categoryPrefix}-parent`,
        sort_order: 10,
        is_active: 1,
      },
    });
    ensureStatus(parentResp, 201);
    const parentId = Number(ensureJsonField(parentResp, 'id'));

    const childResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: adminToken,
      body: {
        name: `${categoryPrefix}-child`,
        parent_id: parentId,
        sort_order: 20,
        is_active: 1,
      },
    });
    ensureStatus(childResp, 201);
    const childId = Number(ensureJsonField(childResp, 'id'));

    const articleResp = await request({
      base: apiBase,
      path: '/api/faq/articles',
      method: 'POST',
      token: adminToken,
      body: {
        title: uniqueCode('FAQ-CATEGORY-FORCE'),
        summary: 'category force delete smoke',
        category_id: childId,
        tags: ['smoke', 'category-force-delete'],
      },
    });
    ensureStatus(articleResp, 201);
    const articleId = Number(ensureJsonField(articleResp, 'id'));

    const forceDeleteResp = await request({
      base: apiBase,
      path: `/api/faq/categories/${parentId}/force-delete`,
      method: 'POST',
      token: adminToken,
      body: {},
    });
    ensureStatus(forceDeleteResp, 200);
    expect(Number(forceDeleteResp.json?.deleted_category_count || 0)).toBe(2);
    expect(Array.isArray(forceDeleteResp.json?.deleted_category_ids)).toBe(true);
    expect(forceDeleteResp.json.deleted_category_ids.map((item) => Number(item))).toEqual(expect.arrayContaining([parentId, childId]));
    expect(Number(forceDeleteResp.json?.recycled_article_count || 0)).toBe(1);
    expect(Array.isArray(forceDeleteResp.json?.recycled_article_ids)).toBe(true);
    expect(forceDeleteResp.json.recycled_article_ids.map((item) => Number(item))).toContain(articleId);

    const categoryListResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'GET',
      token: adminToken,
    });
    ensureStatus(categoryListResp, 200);
    const categoryIds = Array.isArray(categoryListResp.json) ? categoryListResp.json.map((item) => Number(item?.id || 0)) : [];
    expect(categoryIds).not.toContain(parentId);
    expect(categoryIds).not.toContain(childId);

    const recycleResp = await request({
      base: apiBase,
      path: '/api/faq/articles?recycle=1&page=1&limit=50',
      method: 'GET',
      token: adminToken,
    });
    ensureStatus(recycleResp, 200);
    const recycled = Array.isArray(recycleResp.json?.items)
      ? recycleResp.json.items.find((item) => Number(item?.id || 0) === articleId)
      : null;
    expect(recycled).toBeTruthy();
    expect(Number(recycled?.is_deleted || 0)).toBe(1);
    expect(recycled?.category_id ?? null).toBe(null);
  });

  it('should enforce category delete rules and support partial batch delete', async () => {
    const authToken = await resolveWriterToken({ authBase, apiBase, optional: true });
    if (!authToken) {
      console.warn('[faq smoke] skip: no FAQ writer token could be resolved');
      return;
    }
    const writerInfo = await resolveSessionInfo({ apiBase, token: authToken });
    if (!writerInfo.ok || !writerInfo.permissions?.can_write_faq) {
      console.warn(`[faq smoke] skip: writer token unavailable for FAQ write (${writerInfo.status} ${writerInfo.reason || ''})`);
      return;
    }

    const categoryPrefix = uniqueCode('FAQ-CATEGORY-DELETE');

    const parentResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: authToken,
      body: {
        name: `${categoryPrefix}-parent`,
        sort_order: 10,
        is_active: 1,
      },
    });
    ensureStatus(parentResp, 201);
    const parentId = Number(ensureJsonField(parentResp, 'id'));

    const childResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: authToken,
      body: {
        name: `${categoryPrefix}-child`,
        parent_id: parentId,
        sort_order: 20,
        is_active: 1,
      },
    });
    ensureStatus(childResp, 201);
    const childId = Number(ensureJsonField(childResp, 'id'));
    expect(childId).toBeGreaterThan(0);

    const linkedResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: authToken,
      body: {
        name: `${categoryPrefix}-linked`,
        sort_order: 30,
        is_active: 1,
      },
    });
    ensureStatus(linkedResp, 201);
    const linkedId = Number(ensureJsonField(linkedResp, 'id'));

    const freeResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: authToken,
      body: {
        name: `${categoryPrefix}-free`,
        sort_order: 40,
        is_active: 1,
      },
    });
    ensureStatus(freeResp, 201);
    const freeId = Number(ensureJsonField(freeResp, 'id'));

    const articleResp = await request({
      base: apiBase,
      path: '/api/faq/articles',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('FAQ-CATEGORY-LINK'),
        summary: 'category delete smoke',
        category_id: linkedId,
        tags: ['smoke', 'category-delete'],
      },
    });
    ensureStatus(articleResp, 201);

    const linkedDeleteResp = await request({
      base: apiBase,
      path: `/api/faq/categories/${linkedId}`,
      method: 'DELETE',
      token: authToken,
    });
    expect(linkedDeleteResp.status).toBe(409);
    expect(normalizeText(linkedDeleteResp.json?.error || linkedDeleteResp.text)).toContain('该分类下有FAQ');

    const parentDeleteResp = await request({
      base: apiBase,
      path: `/api/faq/categories/${parentId}`,
      method: 'DELETE',
      token: authToken,
    });
    expect(parentDeleteResp.status).toBe(409);
    expect(normalizeText(parentDeleteResp.json?.error || parentDeleteResp.text)).toContain('该分类下有子分类');

    const batchDeleteResp = await request({
      base: apiBase,
      path: '/api/faq/categories/batch-delete',
      method: 'POST',
      token: authToken,
      body: {
        ids: [freeId, linkedId, parentId],
      },
    });
    ensureStatus(batchDeleteResp, 200);
    expect(Number(batchDeleteResp.json?.total || 0)).toBe(3);
    expect(Number(batchDeleteResp.json?.success_count || 0)).toBe(1);
    expect(Number(batchDeleteResp.json?.failure_count || 0)).toBe(2);
    expect(Array.isArray(batchDeleteResp.json?.deleted_ids)).toBe(true);
    expect(batchDeleteResp.json.deleted_ids.map((item) => Number(item))).toContain(freeId);
    expect(Array.isArray(batchDeleteResp.json?.failures)).toBe(true);
    expect(batchDeleteResp.json.failures.some(
      (item) => Number(item?.id || 0) === linkedId && normalizeText(item?.error).includes('该分类下有FAQ')
    )).toBe(true);
    expect(batchDeleteResp.json.failures.some(
      (item) => Number(item?.id || 0) === parentId && normalizeText(item?.error).includes('该分类下有子分类')
    )).toBe(true);

    const listResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(listResp, 200);
    const categoryIds = Array.isArray(listResp.json) ? listResp.json.map((item) => Number(item?.id || 0)) : [];
    expect(categoryIds).not.toContain(freeId);
    expect(categoryIds).toContain(linkedId);
    expect(categoryIds).toContain(parentId);
  });

  it('should batch delete selected child categories before their selected parents', async () => {
    const authToken = await resolveAdminToken({ authBase, apiBase, optional: true });
    if (!authToken) {
      console.warn('[faq smoke] skip: no FAQ admin token could be resolved');
      return;
    }
    const adminInfo = await resolveSessionInfo({ apiBase, token: authToken });
    if (!adminInfo.ok || adminInfo.role !== 'admin') {
      console.warn(`[faq smoke] skip: admin token unavailable for FAQ admin batch delete (${adminInfo.status} ${adminInfo.reason || ''})`);
      return;
    }

    const categoryPrefix = uniqueCode('FAQ-CATEGORY-BATCH-TREE');

    const parentResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: authToken,
      body: {
        name: `${categoryPrefix}-parent`,
        library_scope: 'global',
        sort_order: 10,
        is_active: 1,
      },
    });
    ensureStatus(parentResp, 201);
    const parentId = Number(ensureJsonField(parentResp, 'id'));

    const childResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'POST',
      token: authToken,
      body: {
        name: `${categoryPrefix}-child`,
        parent_id: parentId,
        library_scope: 'global',
        sort_order: 20,
        is_active: 1,
      },
    });
    ensureStatus(childResp, 201);
    const childId = Number(ensureJsonField(childResp, 'id'));

    const batchDeleteResp = await request({
      base: apiBase,
      path: '/api/faq/categories/batch-delete',
      method: 'POST',
      token: authToken,
      body: {
        ids: [parentId, childId],
      },
    });
    ensureStatus(batchDeleteResp, 200);
    expect(Number(batchDeleteResp.json?.total || 0)).toBe(2);
    expect(Number(batchDeleteResp.json?.success_count || 0)).toBe(2);
    expect(Number(batchDeleteResp.json?.failure_count || 0)).toBe(0);
    expect(batchDeleteResp.json?.deleted_ids?.map((item) => Number(item))).toEqual([childId, parentId]);

    const listResp = await request({
      base: apiBase,
      path: '/api/faq/categories',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(listResp, 200);
    const categoryIds = Array.isArray(listResp.json) ? listResp.json.map((item) => Number(item?.id || 0)) : [];
    expect(categoryIds).not.toContain(parentId);
    expect(categoryIds).not.toContain(childId);
  });

  it('should create article, upload version and query preview/download', async () => {
    const authToken = await resolveWriterToken({ authBase, apiBase, optional: true });
    if (!authToken) {
      console.warn('[faq smoke] skip: no FAQ writer token could be resolved');
      return;
    }
    const writerInfo = await resolveSessionInfo({ apiBase, token: authToken });
    if (!writerInfo.ok || !writerInfo.permissions?.can_write_faq) {
      console.warn(`[faq smoke] skip: writer token unavailable for FAQ write (${writerInfo.status} ${writerInfo.reason || ''})`);
      return;
    }
    const writerRole = writerInfo.role;
    const reviewerToken = writerRole === 'admin'
      ? authToken
      : await resolveReviewerToken({ authBase, apiBase, optional: true });
    const auditorToken = await resolveAuditorToken({ authBase, apiBase, optional: true });
    const adminToken = writerRole === 'admin'
      ? authToken
      : await resolveAdminToken({ authBase, apiBase, optional: true });

    const createResp = await request({
      base: apiBase,
      path: '/api/faq/articles',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('FAQ-CASE'),
        summary: 'smoke case',
        tags: ['smoke', 'faq'],
      },
    });
    ensureStatus(createResp, 201);
    const articleId = Number(ensureJsonField(createResp, 'id'));

    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\nsmoke'], { type: 'application/pdf' }), `smoke-${Date.now()}.pdf`);
    const uploadResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/upload`,
      method: 'POST',
      token: authToken,
      body: form,
    });
    ensureStatus(uploadResp, 201);
    const versionId = Number(ensureJsonField(uploadResp, 'id'));

    const form2 = new FormData();
    form2.append('file', new Blob(['%PDF-1.4\nsmoke-v2'], { type: 'application/pdf' }), `smoke-v2-${Date.now()}.pdf`);
    const uploadResp2 = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/upload`,
      method: 'POST',
      token: authToken,
      body: form2,
    });
    ensureStatus(uploadResp2, 201);
    const versionId2 = Number(ensureJsonField(uploadResp2, 'id'));

    const listResp = await request({
      base: apiBase,
      path: '/api/faq/articles?page=1&limit=10',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(listResp, 200);
    expect(Array.isArray(listResp.json?.items)).toBe(true);

    const detailResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(detailResp, 200);
    expect(Number(detailResp.json?.id)).toBe(articleId);

    const previewResp = await request({
      base: apiBase,
      path: `/api/faq/versions/${versionId}/preview`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(previewResp, 200);

    const downloadResp = await request({
      base: apiBase,
      path: `/api/faq/versions/${versionId}/download`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(downloadResp, 200);

    const publishCheckResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/publish/check`,
      method: 'POST',
      token: authToken,
      body: { version_id: versionId2 },
    });
    ensureStatus(publishCheckResp, 200);
    const directRequiresReview = Boolean(publishCheckResp.json?.requires_review);
    expect(Array.isArray(publishCheckResp.json?.checks)).toBe(true);

    const compareResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/versions/compare?left_version_id=${versionId2}&right_version_id=${versionId}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(compareResp, 200);

    const publishResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/publish`,
      method: 'POST',
      token: authToken,
      body: { version_id: versionId2, publish_note: 'smoke 发布说明', mode: 'direct' },
    });
    if (directRequiresReview) {
      ensureStatus(publishResp, 201);
      const autoRequestId = Number(publishResp.json?.request?.id || 0);
      expect(autoRequestId).toBeGreaterThan(0);
      if (reviewerToken) {
        const autoApproveResp = await request({
          base: apiBase,
          path: `/api/faq/publish-requests/${autoRequestId}/review`,
          method: 'POST',
          token: reviewerToken,
          body: { action: 'approve', comment: 'smoke direct fallback approve' },
        });
        ensureStatus(autoApproveResp, 200);
      } else {
        console.warn('[faq smoke] skip auto-approve: reviewer token unavailable');
      }
    } else {
      ensureStatus(publishResp, 200);
    }

    const feedbackResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/feedback`,
      method: 'POST',
      token: authToken,
      body: {
        solved: false,
        reason_code: 'unclear_steps',
        reason_text: 'smoke 提交反馈',
      },
    });
    ensureStatus(feedbackResp, 200);

    const feedbackSummaryResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/feedback/summary`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(feedbackSummaryResp, 200);
    expect(Number(feedbackSummaryResp.json?.total || 0)).toBeGreaterThanOrEqual(1);

    const favAddResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/favorite`,
      method: 'POST',
      token: authToken,
      body: {},
    });
    ensureStatus(favAddResp, 200);

    const favListResp = await request({
      base: apiBase,
      path: '/api/faq/favorites',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(favListResp, 200);
    expect(Array.isArray(favListResp.json)).toBe(true);
    expect(favListResp.json.some((item) => Number(item.article_id) === articleId)).toBe(true);

    const favDeleteResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/favorite`,
      method: 'DELETE',
      token: authToken,
    });
    ensureStatus(favDeleteResp, 200);

    const sectionStatusResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/editor/sections`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(sectionStatusResp, 200);
    const firstSectionKey = String(sectionStatusResp.json?.sections?.[0]?.key || '').trim();
    const collabMode = String(sectionStatusResp.json?.collab_mode || '').trim().toLowerCase();
    if (firstSectionKey && collabMode === 'section') {
      const lockResp = await request({
        base: apiBase,
        path: `/api/faq/articles/${articleId}/editor/sections/lock`,
        method: 'POST',
        token: authToken,
        body: { section_key: firstSectionKey },
      });
      ensureStatus(lockResp, 200);

      const releaseResp = await request({
        base: apiBase,
        path: `/api/faq/articles/${articleId}/editor/sections/release`,
        method: 'POST',
        token: authToken,
        body: { section_key: firstSectionKey },
      });
      ensureStatus(releaseResp, 200);
    }

    const form3 = new FormData();
    form3.append('file', new Blob(['%PDF-1.4\nsmoke-v3'], { type: 'application/pdf' }), `smoke-v3-${Date.now()}.pdf`);
    const uploadResp3 = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/upload`,
      method: 'POST',
      token: authToken,
      body: form3,
    });
    ensureStatus(uploadResp3, 201);
    const versionId3 = Number(ensureJsonField(uploadResp3, 'id'));

    const reviewPublishResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}/publish`,
      method: 'POST',
      token: authToken,
      body: { version_id: versionId3, publish_note: 'smoke 提审说明', mode: 'review' },
    });
    ensureStatus(reviewPublishResp, 201);
    const requestId = Number(reviewPublishResp.json?.request?.id || 0);
    expect(requestId).toBeGreaterThan(0);
    if (reviewerToken) {
      const requestListResp = await request({
        base: apiBase,
        path: '/api/faq/publish-requests?status=pending&page=1&limit=20',
        method: 'GET',
        token: reviewerToken,
      });
      ensureStatus(requestListResp, 200);
      expect(Array.isArray(requestListResp.json?.items)).toBe(true);
      expect(requestListResp.json.items.some((item) => Number(item.id) === requestId)).toBe(true);

      const approveResp = await request({
        base: apiBase,
        path: `/api/faq/publish-requests/${requestId}/review`,
        method: 'POST',
        token: reviewerToken,
        body: { action: 'approve', comment: 'smoke approve' },
      });
      ensureStatus(approveResp, 200);
    } else {
      console.warn('[faq smoke] skip reviewer endpoints: reviewer/admin token unavailable');
    }

    const statsTrendResp = await request({
      base: apiBase,
      path: '/api/faq/stats/trend?days=14',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(statsTrendResp, 200);
    expect(Array.isArray(statsTrendResp.json)).toBe(true);

    const statsTopResp = await request({
      base: apiBase,
      path: '/api/faq/stats/top?limit=10',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(statsTopResp, 200);
    expect(Array.isArray(statsTopResp.json)).toBe(true);

    if (adminToken) {
      const reindexResp = await request({
        base: apiBase,
        path: '/api/faq/reindex/search-text',
        method: 'POST',
        token: adminToken,
        body: { limit: 50 },
      });
      ensureStatus(reindexResp, 200);

      const purgeResp = await request({
        base: apiBase,
        path: '/api/faq/recycle/purge',
        method: 'POST',
        token: adminToken,
        body: {},
      });
      ensureStatus(purgeResp, 200);
    } else {
      console.warn('[faq smoke] skip admin endpoints: admin token unavailable');
    }

    if (auditorToken) {
      const logsResp = await request({
        base: apiBase,
        path: '/api/faq/logs?page=1&limit=20',
        method: 'GET',
        token: auditorToken,
      });
      ensureStatus(logsResp, 200);
      expect(Array.isArray(logsResp.json?.items)).toBe(true);

      const outboxResp = await request({
        base: apiBase,
        path: '/api/faq/events/outbox?limit=20',
        method: 'GET',
        token: auditorToken,
      });
      ensureStatus(outboxResp, 200);
      expect(Array.isArray(outboxResp.json)).toBe(true);
    } else {
      console.warn('[faq smoke] skip auditor endpoints: auditor token unavailable');
    }
  });

  it('should purge recycled articles from recycle bin', async () => {
    const adminToken = await resolveAdminToken({ authBase, apiBase, optional: true });
    if (!adminToken) {
      console.warn('[faq smoke] skip: no FAQ admin token could be resolved for recycle purge');
      return;
    }
    const adminInfo = await resolveSessionInfo({ apiBase, token: adminToken });
    if (!adminInfo.ok || adminInfo.role !== 'admin') {
      console.warn(`[faq smoke] skip: admin token unavailable for recycle purge (${adminInfo.status} ${adminInfo.reason || ''})`);
      return;
    }

    const articleResp = await request({
      base: apiBase,
      path: '/api/faq/articles',
      method: 'POST',
      token: adminToken,
      body: {
        title: uniqueCode('FAQ-RECYCLE-PURGE'),
        summary: 'recycle purge smoke',
        tags: ['smoke', 'recycle-purge'],
        library_scope: 'global',
      },
    });
    ensureStatus(articleResp, 201);
    const articleId = Number(ensureJsonField(articleResp, 'id'));

    const recycleResp = await request({
      base: apiBase,
      path: `/api/faq/articles/${articleId}`,
      method: 'DELETE',
      token: adminToken,
    });
    ensureStatus(recycleResp, 200);

    const purgeResp = await request({
      base: apiBase,
      path: '/api/faq/articles/batch',
      method: 'POST',
      token: adminToken,
      body: {
        action: 'purge',
        article_ids: [articleId],
      },
    });
    ensureStatus(purgeResp, 200);
    expect(Number(purgeResp.json?.total || 0)).toBe(1);

    const recycleListResp = await request({
      base: apiBase,
      path: '/api/faq/articles?recycle=1&page=1&limit=50',
      method: 'GET',
      token: adminToken,
    });
    ensureStatus(recycleListResp, 200);
    const recycled = Array.isArray(recycleListResp.json?.items)
      ? recycleListResp.json.items.find((item) => Number(item?.id || 0) === articleId)
      : null;
    expect(recycled).toBeFalsy();
  });
});

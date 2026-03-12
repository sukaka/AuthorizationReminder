const {
  getApiBase,
  getAuthBase,
  request,
  ensureStatus,
  ensureJsonField,
  uniqueCode,
  loginByPassword,
} = require('./helpers/api');
const PizZip = require('pizzip');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const buildMinimalDocxBlob = () => {
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
    <w:p><w:r><w:t>Tender smoke test docx</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
  );
  zip.folder('word').folder('_rels').file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );

  const buffer = zip.generate({ type: 'nodebuffer' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
};

const buildDocxBlobFromLines = (lines = []) => {
  const paragraphXml = (Array.isArray(lines) ? lines : [])
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${String(line).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`)
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
    ${paragraphXml}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
  );
  zip.folder('word').folder('_rels').file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  const buffer = zip.generate({ type: 'nodebuffer' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
};

const buildAnalyzeDocxBlob = (bidCategory = 'SERVICE') => {
  const isProduct = String(bidCategory || '').toUpperCase() === 'PRODUCT';
  const bodyLines = isProduct
    ? [
      '投标邀请',
      '本项目为货物类采购，欢迎符合条件的供应商参与投标。',
      '投标人须知',
      '投标报价超过最高限价的，作无效投标处理。',
      '投标人须知前附表',
      '项目编号：SMOKE-PRODUCT-001，投标有效期90日历天。',
      '采购需求',
      '需提供核心产品，包含设备主机与配套组件。',
      '技术参数表',
      '参数序号 | 参数名称 | 技术要求',
      '1 | 核心处理器 | ★主频不低于3.0GHz，不满足作无效投标处理',
      '2 | 内存容量 | ≥32GB，负偏离无效',
      '评分表',
      '评分项 | 分值 | 评分标准',
      '技术参数响应 | 40分 | 完全满足得40分，负偏离每项扣5分',
      '商务响应 | 20分 | 提供原厂授权及检测报告得满分',
      '评标方法与评标标准',
      '采用综合评分法，价格评分按最低评标价法折算。',
      '合同主要条款及格式',
      '违约责任：逾期交付按日扣款，严重违约可解除合同。',
      '附件',
      '附件1：报价一览表；附件2：分项报价表；附件3：偏离表。',
    ]
    : [
      '投标邀请',
      '本项目为服务类采购，欢迎符合条件的供应商参与投标。',
      '投标人须知',
      '未按要求提交响应材料的，作无效投标处理。',
      '投标人须知前附表',
      '项目编号：SMOKE-SERVICE-001，投标有效期90日历天。',
      '采购需求',
      '需提供驻场服务，确保服务可用性不低于99.9%。',
      '评标方法与评标标准',
      '评分项 | 分值 | 评分标准',
      '服务方案 | 40分 | 方案完整、可执行、可量化得满分',
      '人员配置 | 20分 | 项目经理具备同类项目经验得满分',
      '报价评分 | 30分 | 采用低价优先法计算',
      '合同主要条款及格式',
      '违约责任：响应超时扣款，连续两次不达标可终止合同。',
      '附件',
      '附件1：服务承诺书；附件2：偏离表格式；附件3：报价表。',
      '投标文件格式',
      '第一章 项目理解；第二章 实施方案；第三章 服务保障；第四章 应急响应。',
    ];

  return buildDocxBlobFromLines(bodyLines);
};

const resolveAuthToken = async ({ authBase }) => {
  const directToken = String(process.env.AUTH_TOKEN || '').trim();
  if (directToken) return directToken;

  const builtinPassword = String(process.env.BUILTIN_PASSWORD || '123456');
  const adminLogin = String(process.env.ADMIN_LOGIN || process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || builtinPassword).trim();
  try {
    return await loginByPassword({ authBase, loginId: adminLogin, password: adminPassword });
  } catch (err) {
    const fallbackSecret = String(
      process.env.AUTH_JWT_SECRET
      || '3122c0763b7728783ce33c724c81fcdf3b9c77fe33cdc3cbfe5a6f4a896634ea'
    ).trim();
    if (!fallbackSecret) throw err;
    return jwt.sign(
      { id: Number(process.env.AUTH_FALLBACK_USER_ID || 1), username: adminLogin || 'admin', role: 'admin' },
      fallbackSecret,
      { expiresIn: '2h' }
    );
  }
};

const signFallbackToken = ({ id, username, role = 'editor' }) => {
  const fallbackSecret = String(
    process.env.AUTH_JWT_SECRET
    || '3122c0763b7728783ce33c724c81fcdf3b9c77fe33cdc3cbfe5a6f4a896634ea'
  ).trim();
  return jwt.sign(
    {
      id: Number(id),
      username: String(username || '').trim(),
      role: String(role || 'editor').trim(),
    },
    fallbackSecret,
    { expiresIn: '2h' }
  );
};

const loadAuthUserByUsername = async (username) => {
  const loginId = String(username || '').trim();
  if (!loginId) return null;
  const connection = await mysql.createConnection({
    host: String(process.env.AUTH_DB_HOST || process.env.MYSQL_HOST || '127.0.0.1'),
    port: Number(process.env.AUTH_DB_PORT || process.env.MYSQL_PORT || 3308),
    user: String(process.env.AUTH_DB_USER || process.env.MYSQL_USER || 'juxin'),
    password: String(process.env.AUTH_DB_PASSWORD || process.env.MYSQL_SHARED_APP_PASSWORD || process.env.MYSQL_PASSWORD || ''),
    database: String(process.env.AUTH_DB_NAME || process.env.MYSQL_DATABASE || 'juxin_reminder'),
  });
  try {
    const [rows] = await connection.query(
      'SELECT id, username, role, is_active FROM users WHERE username = ? LIMIT 1',
      [loginId]
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row || Number(row.is_active) !== 1) return null;
    return {
      id: Number(row.id),
      username: String(row.username || ''),
      role: String(row.role || 'viewer'),
    };
  } finally {
    await connection.end();
  }
};

const createTenderDbConnection = async () => mysql.createConnection({
  host: String(process.env.TENDER_DB_HOST || process.env.MYSQL_HOST || '127.0.0.1'),
  port: Number(process.env.TENDER_DB_PORT || process.env.MYSQL_PORT || 3308),
  user: String(process.env.MYSQL_USER || 'tender_user'),
  password: String(process.env.MYSQL_PASSWORD || 'tender_pass'),
  database: String(process.env.MYSQL_DATABASE || 'juxin_tender'),
});

const toMojibake = (text) => Buffer.from(String(text || ''), 'utf8').toString('latin1');

describe('tender smoke e2e', () => {
  const apiBase = getApiBase();
  const authBase = getAuthBase();

  it('should create bid, upload version and call ai list endpoints', async () => {
    const authToken = await resolveAuthToken({ authBase });

    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('BID'),
        customer_name: 'Smoke客户',
        project_name: 'Smoke项目',
        summary: 'smoke case',
      },
    });
    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const form = new FormData();
    form.append('file', buildMinimalDocxBlob(), `smoke-${Date.now()}.docx`);

    const uploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/versions/upload`,
      method: 'POST',
      token: authToken,
      body: form,
    });
    ensureStatus(uploadResp, 201);

    const form2 = new FormData();
    form2.append('file', buildMinimalDocxBlob(), `smoke-${Date.now()}-v2.docx`);
    const uploadResp2 = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/versions/upload`,
      method: 'POST',
      token: authToken,
      body: form2,
    });
    ensureStatus(uploadResp2, 201);

    const listResp = await request({
      base: apiBase,
      path: '/api/tender/bids?limit=10',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(listResp, 200);
    expect(Array.isArray(listResp.json?.items)).toBe(true);

    const ruleLibraryResp = await request({
      base: apiBase,
      path: '/api/tender/kb/validation-rules?limit=200',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(ruleLibraryResp, 200);
    expect(Array.isArray(ruleLibraryResp.json?.items || [])).toBe(true);
    expect(Number(ruleLibraryResp.json?.total || 0)).toBeGreaterThanOrEqual(100);

    const versionsResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/versions`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(versionsResp, 200);
    expect(Array.isArray(versionsResp.json)).toBe(true);
    expect(versionsResp.json.length).toBeGreaterThanOrEqual(2);
    const [rightVersion, leftVersion] = versionsResp.json;

    const statusParseResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/status`,
      method: 'POST',
      token: authToken,
      body: { status: 'PARSE_COMPLETED' },
    });
    ensureStatus(statusParseResp, 200);
    expect(statusParseResp.json?.status).toBe('PARSE_COMPLETED');

    const statusReadyResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/status`,
      method: 'POST',
      token: authToken,
      body: { status: 'READY_TO_GENERATE' },
    });
    ensureStatus(statusReadyResp, 200);
    expect(statusReadyResp.json?.status).toBe('READY_TO_GENERATE');

    const reviewSubmitResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/reviews/submit`,
      method: 'POST',
      token: authToken,
      body: { review_stage: 'COMPILE', review_comment: 'smoke submit' },
    });
    ensureStatus(reviewSubmitResp, 201);
    const reviewId = Number(reviewSubmitResp.json?.review?.id || 0);
    expect(reviewId).toBeGreaterThan(0);
    expect(reviewSubmitResp.json?.bid?.status).toBe('COMPILE_REVIEW_PENDING');

    const reviewActionResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/reviews/${reviewId}/action`,
      method: 'POST',
      token: authToken,
      body: { action: 'approved', review_comment: 'smoke approved' },
    });
    ensureStatus(reviewActionResp, 200);
    expect(reviewActionResp.json?.bid?.status).toBe('TECH_REVIEW_PENDING');

    const autosaveResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/draft/autosave`,
      method: 'POST',
      token: authToken,
      body: { source: 'MANUAL', note: 'smoke autosave', content_text: 'smoke draft text' },
    });
    ensureStatus(autosaveResp, 201);
    const autosaveId = Number(autosaveResp.json?.id || 0);
    expect(autosaveId).toBeGreaterThan(0);

    const autosaveListResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/draft/autosaves?limit=10`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(autosaveListResp, 200);
    expect(Array.isArray(autosaveListResp.json)).toBe(true);
    expect(autosaveListResp.json.length).toBeGreaterThan(0);

    const rollbackResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/draft/rollback`,
      method: 'POST',
      token: authToken,
      body: { autosave_id: autosaveId, create_snapshot: false },
    });
    ensureStatus(rollbackResp, 200);
    expect(rollbackResp.json?.ok).toBe(true);

    const compareResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/versions/compare?left_version_id=${leftVersion.id}&right_version_id=${rightVersion.id}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(compareResp, 200);
    expect(compareResp.json?.left_version?.id).toBe(Number(leftVersion.id));
    expect(compareResp.json?.right_version?.id).toBe(Number(rightVersion.id));

    const editorEventsResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/editor/events?limit=20`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(editorEventsResp, 200);
    expect(Array.isArray(editorEventsResp.json?.items)).toBe(true);

    const modelsResp = await request({
      base: apiBase,
      path: '/api/tender/ai/models',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(modelsResp, 200);
    expect(Array.isArray(modelsResp.json)).toBe(true);

    const getConfigResp = await request({
      base: apiBase,
      path: '/api/tender/config',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(getConfigResp, 200);
    expect(Number(getConfigResp.json?.audit_retention_days)).toBeGreaterThanOrEqual(30);

    const updateConfigResp = await request({
      base: apiBase,
      path: '/api/tender/config',
      method: 'POST',
      token: authToken,
      body: {
        audit_retention_days: Number(getConfigResp.json?.audit_retention_days || 365),
        ocr_enabled: !!getConfigResp.json?.ocr_enabled,
        ocr_access_key_id: String(getConfigResp.json?.ocr_access_key_id || ''),
        ocr_access_key_secret: String(getConfigResp.json?.ocr_access_key_secret || ''),
        ocr_endpoint: String(getConfigResp.json?.ocr_endpoint || 'ocr.cn-beijing.aliyuncs.com'),
        ocr_api_version: String(getConfigResp.json?.ocr_api_version || '2021-07-07'),
        ocr_timeout_ms: Number(getConfigResp.json?.ocr_timeout_ms || 15000),
      },
    });
    ensureStatus(updateConfigResp, 200);

    const kbStatsResp = await request({
      base: apiBase,
      path: '/api/tender/kb/stats',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(kbStatsResp, 200);
    expect(kbStatsResp.json?.knowledge_base && typeof kbStatsResp.json.knowledge_base === 'object').toBe(true);
    expect(kbStatsResp.json?.runtime_links && typeof kbStatsResp.json.runtime_links === 'object').toBe(true);

    const kbCreateResp = await request({
      base: apiBase,
      path: '/api/tender/kb/projects',
      method: 'POST',
      token: authToken,
      body: {
        project_name: uniqueCode('KB-Project'),
        project_no: uniqueCode('KBNO'),
        purchaser: 'Smoke采购方',
        industry_type: '政府',
        project_type: '服务',
        region: '华东',
        result_status: 'IN_PROGRESS',
      },
    });
    ensureStatus(kbCreateResp, 201);
    expect(Number(kbCreateResp.json?.id || 0)).toBeGreaterThan(0);

    const kbListResp = await request({
      base: apiBase,
      path: '/api/tender/kb/projects?limit=10',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(kbListResp, 200);
    expect(Array.isArray(kbListResp.json?.items)).toBe(true);
    expect(Number(kbListResp.json?.total || 0)).toBeGreaterThan(0);
  });

  it('should expose governance metadata and enforce owned-or-assigned scope for editors', async () => {
    const adminToken = await resolveAuthToken({ authBase });
    const editorUsername = String(process.env.EDITOR_LOGIN || process.env.EDITOR_USERNAME || 'editor').trim() || 'editor';
    const editorAccount = await loadAuthUserByUsername(editorUsername);
    expect(editorAccount).toBeTruthy();
    const editorToken = signFallbackToken({
      id: editorAccount.id,
      username: editorAccount.username,
      role: editorAccount.role || 'editor',
    });

    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: adminToken,
      body: {
        title: uniqueCode('SCOPE-BID'),
        customer_name: 'Scope客户',
        project_name: 'Scope项目',
        summary: 'scope regression',
      },
    });
    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const listBeforeResp = await request({
      base: apiBase,
      path: '/api/tender/bids?limit=200',
      method: 'GET',
      token: editorToken,
    });
    ensureStatus(listBeforeResp, 200);
    expect(Array.isArray(listBeforeResp.json?.items)).toBe(true);
    expect(listBeforeResp.json.items.some((item) => Number(item.id) === bidId)).toBe(false);

    const memberUpdateResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/members`,
      method: 'PUT',
      token: adminToken,
      body: {
        members: [
          {
            member_user_id: editorAccount.id,
            member_username: editorAccount.username,
            member_role: 'COMPILE',
            member_title: '编制负责人',
          },
        ],
      },
    });
    ensureStatus(memberUpdateResp, 200);
    expect(Array.isArray(memberUpdateResp.json?.members)).toBe(true);
    expect(
      memberUpdateResp.json.members.some(
        (item) => String(item.member_username) === editorAccount.username && String(item.member_role) === 'COMPILE'
      )
    ).toBe(true);

    const listAfterResp = await request({
      base: apiBase,
      path: '/api/tender/bids?limit=200',
      method: 'GET',
      token: editorToken,
    });
    ensureStatus(listAfterResp, 200);
    expect(Array.isArray(listAfterResp.json?.items)).toBe(true);
    expect(listAfterResp.json.items.some((item) => Number(item.id) === bidId)).toBe(true);

    const detailResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}`,
      method: 'GET',
      token: editorToken,
    });
    ensureStatus(detailResp, 200);
    expect(Array.isArray(detailResp.json?.members)).toBe(true);
    expect(
      detailResp.json.members.some(
        (item) => String(item.member_username) === editorAccount.username && String(item.member_role) === 'COMPILE'
      )
    ).toBe(true);

    const bootstrapResp = await request({
      base: apiBase,
      path: '/api/tender/bootstrap',
      method: 'GET',
      token: editorToken,
    });
    ensureStatus(bootstrapResp, 200);
    expect(Array.isArray(bootstrapResp.json?.permissions?.menu_permissions)).toBe(true);
    expect(Array.isArray(bootstrapResp.json?.permissions?.page_permissions)).toBe(true);
    expect(Array.isArray(bootstrapResp.json?.permissions?.button_permissions)).toBe(true);
    expect(bootstrapResp.json?.permissions?.menu_permissions).toContain('bids');
    expect(bootstrapResp.json?.permissions?.page_permissions).toContain('bid.parse.workspace');
    expect(bootstrapResp.json?.permissions?.button_permissions).toContain('parse.start');
    expect(bootstrapResp.json?.governance?.data_scope?.mode).toBe('OWNED_OR_ASSIGNED');
    expect(bootstrapResp.json?.governance?.menu_permissions).toContain('risk-center');
    expect(bootstrapResp.json?.governance?.button_permissions).toContain('bid.member.assign');
    expect(bootstrapResp.json?.governance?.permission_matrix?.editor?.data_scope).toBe('OWNED_OR_ASSIGNED');
  });

  it('should ingest parsed bid project into knowledge base with normalized chunk outputs', async () => {
    const authToken = await resolveAuthToken({ authBase });

    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('KB-INGEST-BID'),
        customer_name: '知识库客户',
        project_name: '知识库沉淀项目',
        summary: '用于知识库项目级入库回归',
      },
    });
    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const parseUploadForm = new FormData();
    parseUploadForm.append('file_role', 'MAIN');
    parseUploadForm.append('files', buildAnalyzeDocxBlob('SERVICE'), `kb-ingest-${Date.now()}.docx`);
    const parseUploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/files`,
      method: 'POST',
      token: authToken,
      body: parseUploadForm,
    });
    ensureStatus(parseUploadResp, 201);

    const parseStartResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/start`,
      method: 'POST',
      token: authToken,
      body: {
        parse_scope: 'FULL',
      },
    });
    ensureStatus(parseStartResp, 201);
    expect(Number(parseStartResp.json?.clauses?.length || 0)).toBeGreaterThan(0);

    const kbWorkspaceResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/kb/workspace`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(kbWorkspaceResp, 200);
    expect(Number(kbWorkspaceResp.json?.stats?.ingestable_clauses || 0)).toBeGreaterThan(0);
    expect(kbWorkspaceResp.json?.defaults?.project_name).toBeTruthy();

    const ingestResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/kb/ingest`,
      method: 'POST',
      token: authToken,
      body: {
        result_status: 'WON',
        project_type: 'SERVICE',
        industry_type: '政务',
        region: '华东',
        tags: ['政务', 'service'],
        remarks: 'smoke ingest',
      },
    });
    ensureStatus(ingestResp, 200);
    expect(Number(ingestResp.json?.linked_project?.id || 0)).toBeGreaterThan(0);
    expect(Number(ingestResp.json?.linked_project?.source_bid_id || 0)).toBe(bidId);
    expect(Number(ingestResp.json?.stats?.clause_count || 0)).toBeGreaterThan(0);
    expect(Number(ingestResp.json?.stats?.chunk_count || 0)).toBeGreaterThan(0);
    expect(Array.isArray(ingestResp.json?.ingest_jobs)).toBe(true);
    expect(String(ingestResp.json?.ingest_jobs?.[0]?.status || '')).toBe('SUCCESS');
  });

  it('should create evaluation dataset and run baseline kpi summary for a parsed bid project', async () => {
    const authToken = await resolveAuthToken({ authBase });

    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('EVAL-BID'),
        customer_name: '评测客户',
        project_name: '评测KPI项目',
        summary: '用于评测集和KPI流水线回归',
      },
    });
    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const parseUploadForm = new FormData();
    parseUploadForm.append('file_role', 'MAIN');
    parseUploadForm.append('files', buildAnalyzeDocxBlob('SERVICE'), `evaluation-${Date.now()}.docx`);
    const parseUploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/files`,
      method: 'POST',
      token: authToken,
      body: parseUploadForm,
    });
    ensureStatus(parseUploadResp, 201);

    const parseStartResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/start`,
      method: 'POST',
      token: authToken,
      body: {
        parse_scope: 'FULL',
      },
    });
    ensureStatus(parseStartResp, 201);

    const overviewBeforeResp = await request({
      base: apiBase,
      path: '/api/tender/evaluations/overview',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(overviewBeforeResp, 200);
    expect(overviewBeforeResp.json?.overview && typeof overviewBeforeResp.json.overview === 'object').toBe(true);

    const datasetCreateResp = await request({
      base: apiBase,
      path: '/api/tender/evaluations/datasets',
      method: 'POST',
      token: authToken,
      body: {
        bid_id: bidId,
        dataset_name: `评测样本-${Date.now()}`,
        eval_type: 'CLAUSE_RECOGNITION',
        baseline_flag: true,
      },
    });
    ensureStatus(datasetCreateResp, 201);
    expect(Number(datasetCreateResp.json?.id || 0)).toBeGreaterThan(0);
    expect(String(datasetCreateResp.json?.eval_type || '')).toBe('CLAUSE_RECOGNITION');
    expect(Number(datasetCreateResp.json?.source_bid_id || 0)).toBe(bidId);

    const datasetsResp = await request({
      base: apiBase,
      path: '/api/tender/evaluations/datasets',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(datasetsResp, 200);
    expect(Array.isArray(datasetsResp.json?.items)).toBe(true);
    expect(datasetsResp.json.items.some((item) => Number(item.id) === Number(datasetCreateResp.json.id))).toBe(true);

    const runCreateResp = await request({
      base: apiBase,
      path: '/api/tender/evaluations/runs',
      method: 'POST',
      token: authToken,
      body: {
        run_label: `baseline-${Date.now()}`,
        run_scope: 'BASELINE',
        dataset_ids: [Number(datasetCreateResp.json.id)],
      },
    });
    ensureStatus(runCreateResp, 201);
    expect(Number(runCreateResp.json?.run?.id || 0)).toBeGreaterThan(0);
    expect(Number(runCreateResp.json?.run?.dataset_count || 0)).toBe(1);
    expect(runCreateResp.json?.run?.summary?.kpis?.clause_recognition).toBeTruthy();
    expect(Array.isArray(runCreateResp.json?.items)).toBe(true);
    expect(runCreateResp.json.items).toHaveLength(1);

    const runDetailResp = await request({
      base: apiBase,
      path: `/api/tender/evaluations/runs/${Number(runCreateResp.json.run.id)}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(runDetailResp, 200);
    expect(Number(runDetailResp.json?.run?.id || 0)).toBe(Number(runCreateResp.json.run.id));
    expect(Array.isArray(runDetailResp.json?.items)).toBe(true);
    expect(runDetailResp.json?.items?.[0]?.result?.eval_type).toBe('CLAUSE_RECOGNITION');

    const overviewAfterResp = await request({
      base: apiBase,
      path: '/api/tender/evaluations/overview',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(overviewAfterResp, 200);
    expect(Number(overviewAfterResp.json?.overview?.dataset_count || 0)).toBeGreaterThan(0);
    expect(Number(overviewAfterResp.json?.overview?.run_count || 0)).toBeGreaterThan(0);
    expect(overviewAfterResp.json?.overview?.latest_run?.summary?.kpis?.clause_recognition).toBeTruthy();
  });

  it('should return structured upload errors for invalid sample files', async () => {
    const authToken = await resolveAuthToken({ authBase });
    const form = new FormData();
    form.append('file', new Blob(['not-a-docx'], { type: 'text/plain' }), `bad-${Date.now()}.txt`);

    const resp = await request({
      base: apiBase,
      path: '/api/tender/samples/upload',
      method: 'POST',
      token: authToken,
      body: form,
    });

    expect(resp.status).toBe(400);
    expect(resp.json?.code).toBe('TENDER_UPLOAD_INVALID_FILE');
    expect(resp.json?.category).toBe('UPLOAD');
    expect(resp.json?.retryable).toBe(false);
    expect(resp.json?.manual_takeover && typeof resp.json.manual_takeover === 'object').toBe(true);
  });

  it('should auto-fix mojibake text in bid detail response', async () => {
    const authToken = await resolveAuthToken({ authBase });
    const expectedTitle = `测试投标文件-${Date.now()}`;
    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: authToken,
      body: {
        title: toMojibake(expectedTitle),
        customer_name: '编码客户',
        project_name: '编码项目',
        summary: '编码回归',
      },
    });

    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const detailResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}`,
      method: 'GET',
      token: authToken,
    });

    ensureStatus(detailResp, 200);
    expect(detailResp.json?.title).toBe(expectedTitle);
  });

  it('should generate draft from latest parse workspace result for the current bid', async () => {
    const authToken = await resolveAuthToken({ authBase });

    const templateForm = new FormData();
    templateForm.append('file', buildMinimalDocxBlob(), `parse-bridge-template-${Date.now()}.docx`);
    templateForm.append('template_name', `解析桥接模板-${Date.now()}`);
    templateForm.append('is_default', '1');
    const templateUploadResp = await request({
      base: apiBase,
      path: '/api/tender/doc-templates/upload',
      method: 'POST',
      token: authToken,
      body: templateForm,
    });
    ensureStatus(templateUploadResp, 201);
    const templateId = Number(templateUploadResp.json?.id || 0);
    expect(templateId).toBeGreaterThan(0);

    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('PARSE-GENERATE-BRIDGE'),
        customer_name: '桥接客户',
        project_name: '解析桥接项目',
        summary: '用于项目级 parse 到 generate 桥接回归',
      },
    });
    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const mainUploadForm = new FormData();
    mainUploadForm.append('file_role', 'MAIN');
    mainUploadForm.append('files', buildAnalyzeDocxBlob('SERVICE'), `bridge-main-${Date.now()}.docx`);
    const mainUploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/files`,
      method: 'POST',
      token: authToken,
      body: mainUploadForm,
    });
    ensureStatus(mainUploadResp, 201);

    const clarificationUploadForm = new FormData();
    clarificationUploadForm.append('file_role', 'CLARIFICATION');
    clarificationUploadForm.append(
      'files',
      buildDocxBlobFromLines([
        '澄清说明',
        '本项目投标截止时间顺延至2026年4月2日09:30。',
        '项目名称以最终澄清文件为准。',
      ]),
      `bridge-clarification-${Date.now()}.docx`
    );
    const clarificationUploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/files`,
      method: 'POST',
      token: authToken,
      body: clarificationUploadForm,
    });
    ensureStatus(clarificationUploadResp, 201);

    const attachmentUploadForm = new FormData();
    attachmentUploadForm.append('file_role', 'ATTACHMENT');
    attachmentUploadForm.append(
      'files',
      buildDocxBlobFromLines([
        '附件资料',
        '附件一：服务承诺书。',
        '附件二：报价表。',
      ]),
      `bridge-attachment-${Date.now()}.docx`
    );
    const attachmentUploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/files`,
      method: 'POST',
      token: authToken,
      body: attachmentUploadForm,
    });
    ensureStatus(attachmentUploadResp, 201);

    const parseStartResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/start`,
      method: 'POST',
      token: authToken,
      body: {
        parse_scope: 'FULL',
      },
    });
    ensureStatus(parseStartResp, 201);
    expect(Number(parseStartResp.json?.job?.summary?.file_count || 0)).toBe(3);
    expect(Number(parseStartResp.json?.clauses?.length || 0)).toBeGreaterThan(0);

    const generateResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/generate/from-parse`,
      method: 'POST',
      token: authToken,
      body: {
        bid_category: 'SERVICE',
        doc_template_id: templateId,
      },
      timeoutMs: 60000,
    });
    ensureStatus(generateResp, 201);
    expect(Number(generateResp.json?.job?.created_bid_id || 0)).toBe(bidId);
    expect(Number(generateResp.json?.bid?.id || 0)).toBe(bidId);
    expect(Number(generateResp.json?.version?.id || 0)).toBeGreaterThan(0);
    expect(Number(generateResp.json?.draft?.bid_id || 0)).toBe(bidId);
    expect(Array.isArray(generateResp.json?.draft_sections || [])).toBe(true);
    expect(generateResp.json?.draft_sections?.some((item) => String(item?.section_title || '').trim() === '目录')).toBe(true);
    expect(generateResp.json?.chapter_schema_validation && typeof generateResp.json.chapter_schema_validation === 'object').toBe(true);
    expect(generateResp.json?.chapter_quality_summary && typeof generateResp.json.chapter_quality_summary === 'object').toBe(true);
    expect(Number.isFinite(Number(generateResp.json?.chapter_quality_summary?.overall_score ?? NaN))).toBe(true);
    expect(Array.isArray(generateResp.json?.chapter_quality_summary?.chapter_scores || [])).toBe(true);
  }, 120000);

  it('should persist parse match feedback and reuse it in subsequent recommendations', async () => {
    const authToken = await resolveAuthToken({ authBase });
    const uniqueTag = `SMOKEFEEDBACK${Date.now()}`;
    const adminLogin = String(process.env.ADMIN_LOGIN || process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';

    const createResp = await request({
      base: apiBase,
      path: '/api/tender/bids',
      method: 'POST',
      token: authToken,
      body: {
        title: uniqueCode('PARSE-FEEDBACK'),
        customer_name: '反馈客户',
        project_name: '反馈闭环项目',
        summary: '用于校验 parse 匹配反馈闭环',
      },
    });
    ensureStatus(createResp, 201);
    const bidId = Number(ensureJsonField(createResp, 'id'));

    const uploadForm = new FormData();
    uploadForm.append('file_role', 'MAIN');
    uploadForm.append(
      'files',
      buildDocxBlobFromLines([
        '采购需求',
        `${uniqueTag} ${uniqueTag} ${uniqueTag} 需提供本地服务团队、7×24小时响应和2小时到场保障。`,
      ]),
      `parse-feedback-${Date.now()}.docx`
    );
    const uploadResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/files`,
      method: 'POST',
      token: authToken,
      body: uploadForm,
    });
    ensureStatus(uploadResp, 201);

    const parseStartResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/start`,
      method: 'POST',
      token: authToken,
      body: {
        parse_scope: 'FULL',
      },
    });
    ensureStatus(parseStartResp, 201);
    const clause = (Array.isArray(parseStartResp.json?.clauses) ? parseStartResp.json.clauses : [])
      .find((item) => String(item?.clause_text || '').includes(uniqueTag));
    expect(Number(clause?.id || 0)).toBeGreaterThan(0);

    let strongerSourceId = 0;
    let weakerSourceId = 0;
    const conn = await createTenderDbConnection();
    try {
      await conn.execute(
        `DELETE FROM tender_bid_parse_matches
         WHERE payload_json LIKE '%反馈闭环-%'
            OR payload_json LIKE '%SMOKE-FEEDBACK%'
            OR payload_json LIKE '%SMOKEFEEDBACK%'`
      );
      await conn.execute(
        `DELETE FROM kb_section_assets
         WHERE section_name LIKE '反馈闭环-%'
            OR section_name LIKE 'SMOKE-FEEDBACK%'
            OR section_name LIKE 'SMOKEFEEDBACK%'`
      );
      const [strongerResult] = await conn.execute(
        `INSERT INTO kb_section_assets
          (section_name, sub_section_name, content, quality_score, reusable_flag, tags_json, status)
         VALUES (?, ?, ?, ?, 1, ?, 'ACTIVE')`,
        [
          `${uniqueTag} 售后服务方案`,
          '标准保障',
          `${uniqueTag} ${uniqueTag} ${uniqueTag} 提供本地服务团队、7×24小时响应和2小时到场保障，并提供原厂协同。`,
          96,
          JSON.stringify(['售后', uniqueTag]),
        ]
      );
      strongerSourceId = Number(strongerResult.insertId || 0);
      const [weakerResult] = await conn.execute(
        `INSERT INTO kb_section_assets
          (section_name, sub_section_name, content, quality_score, reusable_flag, tags_json, status)
         VALUES (?, ?, ?, ?, 1, ?, 'ACTIVE')`,
        [
          `${uniqueTag} 服务承诺书`,
          '响应机制',
          `${uniqueTag} ${uniqueTag} ${uniqueTag} 提供本地服务团队、7×24小时响应和2小时到场保障。`,
          78,
          JSON.stringify(['服务承诺', uniqueTag]),
        ]
      );
      weakerSourceId = Number(weakerResult.insertId || 0);
    } finally {
      await conn.end();
    }
    expect(strongerSourceId).toBeGreaterThan(0);
    expect(weakerSourceId).toBeGreaterThan(0);

    const recommendFirstResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/matches/recommend`,
      method: 'POST',
      token: authToken,
      body: {},
    });
    ensureStatus(recommendFirstResp, 200);
    const firstRoundMatches = (Array.isArray(recommendFirstResp.json?.matches) ? recommendFirstResp.json.matches : [])
      .filter((item) => Number(item?.clause_id || 0) === Number(clause.id) && String(item?.match_status || '').toUpperCase() === 'RECOMMENDED')
      .filter((item) => Number(item?.payload?.source_id || 0) === strongerSourceId || Number(item?.payload?.source_id || 0) === weakerSourceId);
    expect(firstRoundMatches.length).toBe(2);
    const initialTopMatch = firstRoundMatches[0];
    const feedbackTargetMatch = firstRoundMatches[1];
    expect(Number(initialTopMatch?.payload?.source_id || 0)).not.toBe(Number(feedbackTargetMatch?.payload?.source_id || 0));

    const confirmResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/matches/bulk`,
      method: 'PUT',
      token: authToken,
      body: {
        items: [
          {
            id: Number(feedbackTargetMatch.id),
            clause_id: Number(clause.id),
            match_status: 'CONFIRMED',
            confidence: Number(feedbackTargetMatch.confidence || 0),
            reason_text: feedbackTargetMatch.reason_text,
            payload: feedbackTargetMatch.payload,
          },
        ],
      },
    });
    ensureStatus(confirmResp, 200);
    const confirmedMatch = (Array.isArray(confirmResp.json?.matches) ? confirmResp.json.matches : [])
      .find((item) => Number(item?.id || 0) === Number(feedbackTargetMatch.id));
    expect(String(confirmedMatch?.match_status || '')).toBe('CONFIRMED');
    expect(confirmedMatch?.payload?.feedback_status).toBe('CONFIRMED');
    expect(confirmedMatch?.payload?.feedback_actor?.username).toBe(adminLogin);

    const recommendSecondResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${bidId}/parse/matches/recommend`,
      method: 'POST',
      token: authToken,
      body: {},
    });
    ensureStatus(recommendSecondResp, 200);
    const preservedConfirmed = (Array.isArray(recommendSecondResp.json?.matches) ? recommendSecondResp.json.matches : [])
      .find((item) => Number(item?.id || 0) === Number(feedbackTargetMatch.id));
    expect(String(preservedConfirmed?.match_status || '')).toBe('CONFIRMED');

    const secondRoundRecommended = (Array.isArray(recommendSecondResp.json?.matches) ? recommendSecondResp.json.matches : [])
      .filter((item) => Number(item?.clause_id || 0) === Number(clause.id) && String(item?.match_status || '').toUpperCase() === 'RECOMMENDED')
      .filter((item) => Number(item?.payload?.source_id || 0) === strongerSourceId || Number(item?.payload?.source_id || 0) === weakerSourceId);
    expect(secondRoundRecommended.length).toBe(2);
    expect(Number(secondRoundRecommended[0]?.payload?.source_id || 0)).toBe(Number(feedbackTargetMatch?.payload?.source_id || 0));
    expect(Number(secondRoundRecommended[0]?.payload?.feedback_score || 0)).toBeGreaterThan(0);
    expect(Number(secondRoundRecommended[0]?.payload?.feedback_summary?.confirmed_count || 0)).toBeGreaterThanOrEqual(1);
    expect(Number(secondRoundRecommended[1]?.payload?.feedback_score || 0)).toBeLessThanOrEqual(0);
  }, 120000);

  it('should upload sample then analyze and create draft from generate job', async () => {
    const authToken = await resolveAuthToken({ authBase });

    const templateForm = new FormData();
    templateForm.append('file', buildMinimalDocxBlob(), `template-${Date.now()}.docx`);
    templateForm.append('template_name', `回归模板-${Date.now()}`);
    templateForm.append('is_default', '1');
    const templateUploadResp = await request({
      base: apiBase,
      path: '/api/tender/doc-templates/upload',
      method: 'POST',
      token: authToken,
      body: templateForm,
    });
    ensureStatus(templateUploadResp, 201);
    const templateId = Number(templateUploadResp.json?.id || 0);
    expect(templateId).toBeGreaterThan(0);

    const templateListResp = await request({
      base: apiBase,
      path: '/api/tender/doc-templates',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(templateListResp, 200);
    expect(Array.isArray(templateListResp.json)).toBe(true);
    expect(templateListResp.json.length).toBeGreaterThan(0);

    const sampleForm = new FormData();
    sampleForm.append('file', buildMinimalDocxBlob(), `sample-${Date.now()}.docx`);
    const sampleUploadResp = await request({
      base: apiBase,
      path: '/api/tender/samples/upload',
      method: 'POST',
      token: authToken,
      body: sampleForm,
    });
    ensureStatus(sampleUploadResp, 201);
    expect(Number(sampleUploadResp.json?.sample?.id || 0)).toBeGreaterThan(0);

    const sampleListResp = await request({
      base: apiBase,
      path: '/api/tender/samples?limit=10',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(sampleListResp, 200);
    expect(Array.isArray(sampleListResp.json?.items)).toBe(true);
    expect(sampleListResp.json.items.length).toBeGreaterThan(0);

    const analyzeForm = new FormData();
    analyzeForm.append('file', buildAnalyzeDocxBlob('SERVICE'), `bidding-${Date.now()}.docx`);
    analyzeForm.append('bid_category', 'SERVICE');
    const analyzeResp = await request({
      base: apiBase,
      path: '/api/tender/bids/generate/analyze',
      method: 'POST',
      token: authToken,
      body: analyzeForm,
      timeoutMs: 60000,
    });
    ensureStatus(analyzeResp, 201);
    const jobId = Number(analyzeResp.json?.job?.id || 0);
    expect(jobId).toBeGreaterThan(0);
    expect(analyzeResp.json?.job?.bid_category).toBe('SERVICE');
    expect(Array.isArray(analyzeResp.json?.scoring_items)).toBe(true);
    expect(Array.isArray(analyzeResp.json?.risk_items)).toBe(true);
    expect(Array.isArray(analyzeResp.json?.table_summaries || [])).toBe(true);
    expect(analyzeResp.json?.final_json && typeof analyzeResp.json.final_json === 'object').toBe(true);
    expect(analyzeResp.json?.final_json?.project_core_info && typeof analyzeResp.json.final_json.project_core_info === 'object').toBe(true);
    expect(analyzeResp.json?.final_json?.invalid_bid_full_clauses && typeof analyzeResp.json.final_json.invalid_bid_full_clauses === 'object').toBe(true);
    expect(Array.isArray(analyzeResp.json?.stage_outputs?.stage1_risk_clauses || [])).toBe(true);
    expect(Array.isArray(analyzeResp.json?.stage_outputs?.stage3_missing_items || [])).toBe(true);
    expect(analyzeResp.json?.stage_outputs?.score_table_extract && typeof analyzeResp.json.stage_outputs.score_table_extract === 'object').toBe(true);
    expect(analyzeResp.json?.stage_outputs?.parse_quality_gate && typeof analyzeResp.json.stage_outputs.parse_quality_gate === 'object').toBe(true);
    expect(String(analyzeResp.json?.stage_outputs?.parse_quality_gate?.status || '')).not.toBe('BLOCK');
    expect(analyzeResp.json?.stage_outputs?.evidence_registry && typeof analyzeResp.json.stage_outputs.evidence_registry === 'object').toBe(true);
    expect(analyzeResp.json?.stage_outputs?.rule_scan_summary && typeof analyzeResp.json.stage_outputs.rule_scan_summary === 'object').toBe(true);
    expect(Number.isFinite(Number(analyzeResp.json?.stage_outputs?.score_table_extract?.merged_count ?? NaN))).toBe(true);
    expect(Number.isFinite(Number(analyzeResp.json?.stage_outputs?.score_table_extract?.merged_total_count ?? NaN))).toBe(true);
    expect(analyzeResp.json?.generated_artifacts && typeof analyzeResp.json.generated_artifacts === 'object').toBe(true);
    expect(Array.isArray(analyzeResp.json?.generated_artifacts?.auto_toc || [])).toBe(true);
    expect(Array.isArray(analyzeResp.json?.generated_artifacts?.service_scheme_outline || [])).toBe(true);
    expect(Array.isArray(analyzeResp.json?.generated_artifacts?.deviation_tables?.technical || [])).toBe(true);
    expect(Array.isArray(analyzeResp.json?.generated_artifacts?.deviation_tables?.business || [])).toBe(true);
    expect(Array.isArray(analyzeResp.json?.generated_artifacts?.response_tables?.technical || [])).toBe(true);
    expect(Array.isArray(analyzeResp.json?.generated_artifacts?.response_tables?.business || [])).toBe(true);
    const serviceDeviationRow = analyzeResp.json?.generated_artifacts?.deviation_tables?.technical?.[0] || null;
    if (serviceDeviationRow) {
      expect(String(serviceDeviationRow.parameter_key || '').trim()).not.toBe('');
      expect(String(serviceDeviationRow.satisfy_basis || '').trim()).not.toBe('');
      expect(String(serviceDeviationRow.evidence_source || '').trim()).not.toBe('');
      expect(String(serviceDeviationRow.risk_grade || '').trim()).not.toBe('');
    }
    const serviceResponseRow = analyzeResp.json?.generated_artifacts?.response_tables?.technical?.[0] || null;
    if (serviceResponseRow) {
      expect(String(serviceResponseRow.parameter_key || '').trim()).not.toBe('');
      expect(String(serviceResponseRow.response_text || '').trim()).not.toBe('');
      expect(String(serviceResponseRow.satisfy_basis || '').trim()).not.toBe('');
      expect(String(serviceResponseRow.risk_grade || '').trim()).not.toBe('');
    }

    const createResp = await request({
      base: apiBase,
      path: `/api/tender/bids/generate/jobs/${jobId}/create`,
      method: 'POST',
      token: authToken,
      body: {
        title: `自动生成回归-${Date.now()}`,
        customer_name: '回归客户',
        project_name: '回归项目',
        summary: '回归验证生成初稿',
        doc_template_id: templateId,
      },
      timeoutMs: 60000,
    });
    ensureStatus(createResp, 201);
    expect(Number(createResp.json?.bid?.id || 0)).toBeGreaterThan(0);
    expect(Number(createResp.json?.version?.id || 0)).toBeGreaterThan(0);
    expect(createResp.json?.clause_route_execution && typeof createResp.json.clause_route_execution === 'object').toBe(true);
    expect(createResp.json?.chapter_schema_validation && typeof createResp.json.chapter_schema_validation === 'object').toBe(true);
    expect(createResp.json?.chapter_schema_validation?.valid).toBe(true);
    expect(createResp.json?.chapter_quality_summary && typeof createResp.json.chapter_quality_summary === 'object').toBe(true);
    expect(Number.isFinite(Number(createResp.json?.chapter_quality_summary?.overall_score ?? NaN))).toBe(true);
    expect(Array.isArray(createResp.json?.chapter_quality_summary?.chapter_scores || [])).toBe(true);
    expect(Array.isArray(createResp.json?.draft_sections || [])).toBe(true);
    expect(createResp.json?.draft_sections?.some((item) => String(item?.section_title || '').trim() === '目录')).toBe(true);
    const createdBidId = Number(createResp.json?.bid?.id || 0);

    const checkResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${createdBidId}/check`,
      method: 'POST',
      token: authToken,
      body: {},
    });
    ensureStatus(checkResp, 200);
    expect(checkResp.json?.summary && typeof checkResp.json.summary === 'object').toBe(true);
    expect(Array.isArray(checkResp.json?.issues || [])).toBe(true);
    expect(Array.isArray(checkResp.json?.clause_registry_v2 || [])).toBe(true);
    expect(checkResp.json?.rule_execution && typeof checkResp.json.rule_execution === 'object').toBe(true);
    expect(Number(checkResp.json?.rule_execution?.active_rule_count || 0)).toBeGreaterThanOrEqual(100);

    const targetRequirement = Array.isArray(checkResp.json?.requirement_registry)
      ? checkResp.json.requirement_registry.find((item) => String(item?.requirement_code || '').trim())
      : null;
    expect(targetRequirement && typeof targetRequirement === 'object').toBeTruthy();
    const targetRequirementCode = String(targetRequirement?.requirement_code || '').trim();
    const targetRequirementText = String(
      targetRequirement?.requirement_text || targetRequirement?.title || targetRequirementCode
    ).trim();

    const saveSectionsResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${createdBidId}/draft/sections`,
      method: 'PUT',
      token: authToken,
      body: {
        sections: [
          {
            section_title: '冲突校验章节',
            paragraph_no: 1,
            paragraph_text: `我方对“${targetRequirementText}”完全满足，无偏离。`,
            requirement_ids: [targetRequirementCode],
            evidence_ids: [],
            score_item_ids: [],
          },
        ],
      },
    });
    ensureStatus(saveSectionsResp, 200);

    const saveArtifactsResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${createdBidId}/draft/artifacts`,
      method: 'PUT',
      token: authToken,
      body: {
        artifacts: {
          deviation_tables: {
            technical: [
              {
                tender_requirement: targetRequirementText,
                bidder_response: '满足',
                deviation_note: '无偏离',
              },
            ],
            business: [],
          },
          response_tables: {
            technical: [
              {
                tender_requirement: targetRequirementText,
                response_text: '不满足，存在偏离。',
                evidence_source: '人工录入',
              },
            ],
            business: [],
          },
        },
      },
    });
    ensureStatus(saveArtifactsResp, 200);

    const conflictCheckResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${createdBidId}/check`,
      method: 'POST',
      token: authToken,
      body: {},
    });
    ensureStatus(conflictCheckResp, 200);
    expect(conflictCheckResp.json?.issues.some((issue) => issue?.type === 'artifact_table_conflict')).toBe(true);
    expect(conflictCheckResp.json?.issues.some((issue) => issue?.type === 'section_artifact_conflict')).toBe(true);
    expect(Number(conflictCheckResp.json?.rule_execution?.triggered_issue_count || 0)).toBeGreaterThan(0);

    const optimizeResp = await request({
      base: apiBase,
      path: `/api/tender/bids/${createdBidId}/score-optimize`,
      method: 'POST',
      token: authToken,
      body: {},
    });
    ensureStatus(optimizeResp, 200);
    expect(Array.isArray(optimizeResp.json?.matrix || [])).toBe(true);
    expect(Array.isArray(optimizeResp.json?.items || [])).toBe(true);
    expect(Number.isFinite(Number(optimizeResp.json?.applied_count || 0))).toBe(true);
    expect(Array.isArray(optimizeResp.json?.draft_sections || [])).toBe(true);

    const productAnalyzeForm = new FormData();
    productAnalyzeForm.append('file', buildAnalyzeDocxBlob('PRODUCT'), `bidding-product-${Date.now()}.docx`);
    productAnalyzeForm.append('bid_category', 'PRODUCT');
    const productAnalyzeResp = await request({
      base: apiBase,
      path: '/api/tender/bids/generate/analyze',
      method: 'POST',
      token: authToken,
      body: productAnalyzeForm,
      timeoutMs: 60000,
    });
    ensureStatus(productAnalyzeResp, 201);
    expect(productAnalyzeResp.json?.job?.bid_category).toBe('PRODUCT');
    expect(String(productAnalyzeResp.json?.stage_outputs?.parse_quality_gate?.status || '')).not.toBe('BLOCK');
    expect(productAnalyzeResp.json?.final_json?.project_core_info?.project_type).toBe('产品类');
    expect(productAnalyzeResp.json?.final_json?.goods_procurement_detail && typeof productAnalyzeResp.json.final_json.goods_procurement_detail === 'object').toBe(true);
    expect(productAnalyzeResp.json?.final_json?.core_product_info && typeof productAnalyzeResp.json.final_json.core_product_info === 'object').toBe(true);
    expect(Array.isArray(productAnalyzeResp.json?.final_json?.mandatory_clause_list || [])).toBe(true);
    expect(Array.isArray(productAnalyzeResp.json?.final_json?.evaluation_score_matrix || [])).toBe(true);
    expect(Array.isArray(productAnalyzeResp.json?.final_json?.technical_deviation_table || [])).toBe(true);
    expect(Array.isArray(productAnalyzeResp.json?.generated_artifacts?.deviation_tables?.technical || [])).toBe(true);
    const productDeviationRow = productAnalyzeResp.json?.generated_artifacts?.deviation_tables?.technical?.[0] || null;
    if (productDeviationRow) {
      expect(String(productDeviationRow.parameter_key || '').trim()).not.toBe('');
      expect(String(productDeviationRow.satisfy_basis || '').trim()).not.toBe('');
      expect(String(productDeviationRow.evidence_source || '').trim()).not.toBe('');
      expect(String(productDeviationRow.risk_grade || '').trim()).not.toBe('');
    }
  }, 300000);
});

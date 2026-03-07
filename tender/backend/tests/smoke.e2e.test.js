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

  const paragraphXml = bodyLines
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

const resolveAuthToken = async ({ authBase }) => {
  const directToken = String(process.env.AUTH_TOKEN || '').trim();
  if (directToken) return directToken;

  const builtinPassword = String(process.env.BUILTIN_PASSWORD || '123456');
  const adminLogin = String(process.env.ADMIN_LOGIN || process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || builtinPassword).trim();
  return loginByPassword({ authBase, loginId: adminLogin, password: adminPassword });
};

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
    });
    ensureStatus(createResp, 201);
    expect(Number(createResp.json?.bid?.id || 0)).toBeGreaterThan(0);
    expect(Number(createResp.json?.version?.id || 0)).toBeGreaterThan(0);

    const productAnalyzeForm = new FormData();
    productAnalyzeForm.append('file', buildAnalyzeDocxBlob('PRODUCT'), `bidding-product-${Date.now()}.docx`);
    productAnalyzeForm.append('bid_category', 'PRODUCT');
    const productAnalyzeResp = await request({
      base: apiBase,
      path: '/api/tender/bids/generate/analyze',
      method: 'POST',
      token: authToken,
      body: productAnalyzeForm,
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
  });
});

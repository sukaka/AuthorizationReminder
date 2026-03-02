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

const resolveAuthToken = async ({ authBase }) => {
  const directToken = String(process.env.AUTH_TOKEN || '').trim();
  if (directToken) return directToken;

  const builtinPassword = String(process.env.BUILTIN_PASSWORD || '123456');
  const adminLogin = String(process.env.ADMIN_LOGIN || process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || builtinPassword).trim();
  return loginByPassword({ authBase, loginId: adminLogin, password: adminPassword });
};

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
});

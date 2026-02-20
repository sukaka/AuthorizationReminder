const {
  getApiBase,
  request,
  ensureStatus,
  ensureJsonField,
  uniqueCode,
  uploadAttachment,
} = require('./helpers/api');

describe('sec-impl smoke e2e', () => {
  const apiBase = getApiBase();
  const authToken = String(process.env.AUTH_TOKEN || '').trim();

  it('should complete lifecycle to CLOSED and verify core APIs', async () => {
    if (!authToken) {
      throw new Error('缺少 AUTH_TOKEN，请先设置统一登录 Bearer Token');
    }

    const projectCode = uniqueCode('PRJ-SMOKE');

    const createResp = await request({
      base: apiBase,
      path: '/api/sec-impl/projects',
      method: 'POST',
      token: authToken,
      body: {
        project_code: projectCode,
        product_type: 'WAF',
        customer_name: 'SmokeCustomer',
        sales_order_no: uniqueCode('SO'),
        inbound_tracking_no: uniqueCode('IN'),
        remark: 'vitest smoke',
      },
    });
    ensureStatus(createResp, 201);
    const jobId = Number(ensureJsonField(createResp, 'id'));

    const assessResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/assess`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '评估完成',
        stage_payload: { receive_note: '环境评估通过' },
      },
    });
    ensureStatus(assessResp, 200);

    await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'IMPLEMENT',
      remark: '实施留证',
      content: `implement evidence ${Date.now()}`,
    });

    const implementResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/implement`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '实施完成',
        stage_payload: {
          cpu_match: 'PASS',
          memory_match: 'PASS',
          disk_match: 'PASS',
          nic_match: 'PASS',
          serial_match: 'PASS',
        },
      },
    });
    ensureStatus(implementResp, 200);

    await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'TUNE',
      remark: '联调留证',
      content: `tune evidence ${Date.now()}`,
    });

    const tuneResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/tune`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '联调完成',
        stage_payload: {
          os_name: 'JXOS',
          os_version: '1.0.0',
          install_result: 'PASS',
        },
      },
    });
    ensureStatus(tuneResp, 200);

    await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'TRIAL',
      remark: '试运行留证',
      content: `trial evidence ${Date.now()}`,
    });

    const trialResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/trial`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '试运行通过',
        stage_payload: {
          boot_test: 'PASS',
          network_test: 'PASS',
          stress_test: 'PASS',
          test_result: 'PASS',
        },
      },
    });
    ensureStatus(trialResp, 200);

    await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'ACCEPT',
      remark: '验收留证',
      content: `accept evidence ${Date.now()}`,
    });

    const acceptResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/accept`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '验收通过',
        stage_payload: {
          approve_result: 'PASS',
          approve_note: '符合交付标准',
        },
      },
    });
    ensureStatus(acceptResp, 200);

    const handoverResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/handover`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '移交完成',
        stage_payload: {
          package_check: 'PASS',
          accessory_check: 'PASS',
          box_no: uniqueCode('HANDOVER'),
        },
      },
    });
    ensureStatus(handoverResp, 200);

    const closeResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}/stages/close`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '归档完成',
        outbound_tracking_no: uniqueCode('ACC'),
        stage_payload: {
          carrier: '实施负责人',
          shipped_note: '归档完成',
        },
      },
    });
    ensureStatus(closeResp, 200);

    const detailResp = await request({
      base: apiBase,
      path: `/api/sec-impl/projects/${jobId}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(detailResp, 200);
    expect(detailResp.json.current_stage).toBe('CLOSED');
    expect(detailResp.json.project_code).toBe(projectCode);

    const dashboardResp = await request({
      base: apiBase,
      path: '/api/sec-impl/dashboard/summary',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(dashboardResp, 200);
    expect(String(dashboardResp.json.generated_at || '').length).toBeGreaterThan(0);

    const logsResp = await request({
      base: apiBase,
      path: `/api/sec-impl/logs?page=1&limit=20&keyword=${encodeURIComponent(projectCode)}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(logsResp, 200);
    expect(Array.isArray(logsResp.json)).toBe(true);

    const dashboardCsvResp = await request({
      base: apiBase,
      path: '/api/sec-impl/reports/dashboard.csv?stage=CLOSED&overdue_days=1',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(dashboardCsvResp, 200);
    expect(dashboardCsvResp.text.includes('实施单号')).toBe(true);

    const slaSummaryResp = await request({
      base: apiBase,
      path: '/api/sec-impl/sla/summary',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(slaSummaryResp, 200);
    expect(String(slaSummaryResp.json.generated_at || '').length).toBeGreaterThan(0);

    const verifyResp = await request({
      base: apiBase,
      path: '/api/sec-impl/audit/verify?limit=200',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(verifyResp, 200);
    expect(Number(verifyResp.json.total_checked || 0)).toBeGreaterThanOrEqual(0);

    const templateResp = await request({
      base: apiBase,
      path: '/api/sec-impl/templates/projects-import.xlsx',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(templateResp, 200);
    expect(String(templateResp.headers.get('content-type') || '')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const reportResp = await request({
      base: apiBase,
      path: `/api/sec-impl/reports/projects.xlsx?keyword=${encodeURIComponent(projectCode)}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(reportResp, 200);
    expect(String(reportResp.headers.get('content-type') || '')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });
});

const {
  getApiBase,
  getAuthBase,
  request,
  ensureStatus,
  ensureJsonField,
  uniqueCode,
  uploadAttachment,
  loginByPassword,
} = require('./helpers/api');

const parseBool = (value, fallback) => {
  const text = String(value === undefined ? '' : value).trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
};

describe('delivery rbac matrix', () => {
  const apiBase = getApiBase();
  const authBase = getAuthBase();
  const builtinPassword = String(process.env.BUILTIN_PASSWORD || 'Dm1vbnqsILIVjUa5sWixBFos60bKdEKC');

  const adminLogin = String(process.env.ADMIN_LOGIN || process.env.ADMIN_USERNAME || 'admin');
  const adminPassword = String(process.env.ADMIN_PASSWORD || builtinPassword);
  const auditorLogin = String(process.env.AUDITOR_LOGIN || process.env.AUDITOR_USERNAME || 'auditor');
  const auditorPassword = String(process.env.AUDITOR_PASSWORD || builtinPassword);
  const sysadminLogin = String(process.env.SYSADMIN_LOGIN || process.env.SYSADMIN_USERNAME || 'sysadmin');
  const sysadminPassword = String(process.env.SYSADMIN_PASSWORD || builtinPassword);

  const expectSysadminAccess = parseBool(process.env.EXPECT_SYSADMIN_DELIVERY_ACCESS, false);

  it('should enforce role-based permissions', async () => {
    let adminToken = String(process.env.AUTH_TOKEN_ADMIN || '').trim();
    let auditorToken = String(process.env.AUTH_TOKEN_AUDITOR || '').trim();
    let sysadminToken = String(process.env.AUTH_TOKEN_SYSADMIN || '').trim();

    if (!adminToken) {
      adminToken = await loginByPassword({ authBase, loginId: adminLogin, password: adminPassword });
    }
    if (!auditorToken) {
      auditorToken = await loginByPassword({ authBase, loginId: auditorLogin, password: auditorPassword });
    }
    if (!sysadminToken) {
      sysadminToken = await loginByPassword({ authBase, loginId: sysadminLogin, password: sysadminPassword });
    }

    const healthResp = await request({
      base: apiBase,
      path: '/api/health',
      method: 'GET',
      token: adminToken,
    });
    ensureStatus(healthResp, 200);

    const adminMe = await request({
      base: apiBase,
      path: '/api/auth/me',
      method: 'GET',
      token: adminToken,
    });
    ensureStatus(adminMe, 200);

    const auditorMe = await request({
      base: apiBase,
      path: '/api/auth/me',
      method: 'GET',
      token: auditorToken,
    });
    ensureStatus(auditorMe, 200);

    const sysadminMe = await request({
      base: apiBase,
      path: '/api/auth/me',
      method: 'GET',
      token: sysadminToken,
    });
    ensureStatus(sysadminMe, expectSysadminAccess ? 200 : 403);

    const createResp = await request({
      base: apiBase,
      path: '/api/delivery/orders',
      method: 'POST',
      token: adminToken,
      body: {
        project_code: uniqueCode('PRJ-RBAC'),
        product_type: 'NDR',
        customer_name: 'RBAC客户',
        remark: 'rbac matrix',
      },
    });
    ensureStatus(createResp, 201);
    const jobId = Number(ensureJsonField(createResp, 'id'));

    const auditorAssessResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/assess`,
      method: 'POST',
      token: auditorToken,
      body: {
        remark: 'auditor assess',
      },
    });
    ensureStatus(auditorAssessResp, 403);

    const adminAssessResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/assess`,
      method: 'POST',
      token: adminToken,
      body: {
        remark: 'admin assess',
      },
    });
    ensureStatus(adminAssessResp, 200);

    await uploadAttachment({
      apiBase,
      token: adminToken,
      projectId: jobId,
      stageCode: 'IMPLEMENT',
      remark: 'rbac-implement',
      content: `rbac implement ${Date.now()}`,
    });

    const adminImplementResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/implement`,
      method: 'POST',
      token: adminToken,
      body: {
        stage_payload: {
          cpu_match: 'PASS',
          memory_match: 'PASS',
          disk_match: 'PASS',
          nic_match: 'PASS',
          serial_match: 'PASS',
        },
      },
    });
    ensureStatus(adminImplementResp, 200);

    await uploadAttachment({
      apiBase,
      token: adminToken,
      projectId: jobId,
      stageCode: 'TUNE',
      remark: 'rbac-tune',
      content: `rbac tune ${Date.now()}`,
    });

    const adminTuneResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/tune`,
      method: 'POST',
      token: adminToken,
      body: {
        stage_payload: {
          os_name: 'JXOS',
          os_version: '1.0.0',
          install_result: 'PASS',
        },
      },
    });
    ensureStatus(adminTuneResp, 200);

    const auditorUploadResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/attachments`,
      method: 'POST',
      token: auditorToken,
      body: {},
    });
    ensureStatus(auditorUploadResp, 403);

    await uploadAttachment({
      apiBase,
      token: adminToken,
      projectId: jobId,
      stageCode: 'TRIAL',
      remark: 'rbac-trial',
      content: `rbac trial ${Date.now()}`,
    });

    await uploadAttachment({
      apiBase,
      token: adminToken,
      projectId: jobId,
      stageCode: 'ACCEPT',
      remark: 'rbac-accept',
      content: `rbac accept ${Date.now()}`,
    });

    const auditorTrialResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/trial`,
      method: 'POST',
      token: auditorToken,
      body: {
        stage_payload: {
          boot_test: 'PASS',
          network_test: 'PASS',
          stress_test: 'PASS',
          test_result: 'PASS',
        },
      },
    });
    ensureStatus(auditorTrialResp, 403);

    const auditorAcceptResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/accept`,
      method: 'POST',
      token: auditorToken,
      body: {
        stage_payload: {
          approve_result: 'PASS',
          approve_note: 'ok',
        },
      },
    });
    ensureStatus(auditorAcceptResp, 403);

    const auditorReworkResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/rework`,
      method: 'POST',
      token: auditorToken,
      body: {
        target_stage: 'TRIAL',
        reason: 'rbac',
        remark: 'rbac',
      },
    });
    ensureStatus(auditorReworkResp, 403);

    const auditorVerifyResp = await request({
      base: apiBase,
      path: '/api/delivery/audit/verify?limit=100',
      method: 'GET',
      token: auditorToken,
    });
    ensureStatus(auditorVerifyResp, 200);

    const auditorSlaRuleResp = await request({
      base: apiBase,
      path: '/api/delivery/sla/rules',
      method: 'PUT',
      token: auditorToken,
      body: {
        rules: [
          {
            stage_code: 'INIT',
            threshold_hours: 4,
            remind_interval_minutes: 120,
            enabled: true,
          },
        ],
      },
    });
    ensureStatus(auditorSlaRuleResp, 403);

    const adminTrialResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/trial`,
      method: 'POST',
      token: adminToken,
      body: {
        stage_payload: {
          boot_test: 'PASS',
          network_test: 'PASS',
          stress_test: 'PASS',
          test_result: 'PASS',
        },
      },
    });
    ensureStatus(adminTrialResp, 200);

    const adminAcceptResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/accept`,
      method: 'POST',
      token: adminToken,
      body: {
        stage_payload: {
          approve_result: 'PASS',
          approve_note: 'ok',
        },
      },
    });
    ensureStatus(adminAcceptResp, 200);

    const adminHandoverResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/handover`,
      method: 'POST',
      token: adminToken,
      body: {
        stage_payload: {
          package_check: 'PASS',
          accessory_check: 'PASS',
          box_no: uniqueCode('HANDOVER'),
        },
      },
    });
    ensureStatus(adminHandoverResp, 200);

    const adminCloseResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/close`,
      method: 'POST',
      token: adminToken,
      body: {
        stage_payload: {
          carrier: '实施负责人',
          shipped_note: 'rbac close',
        },
      },
    });
    ensureStatus(adminCloseResp, 200);

    const detailResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}`,
      method: 'GET',
      token: adminToken,
    });
    ensureStatus(detailResp, 200);
    expect(detailResp.json.current_stage).toBe('CLOSED');
  });
});

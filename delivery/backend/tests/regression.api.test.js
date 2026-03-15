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

const resolveAuthToken = async ({ authBase }) => {
  const directToken = String(process.env.AUTH_TOKEN || '').trim();
  if (directToken) return directToken;

  const builtinPassword = String(process.env.BUILTIN_PASSWORD || 'Dm1vbnqsILIVjUa5sWixBFos60bKdEKC');
  const adminLogin = String(process.env.ADMIN_LOGIN || process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || builtinPassword).trim();
  return loginByPassword({ authBase, loginId: adminLogin, password: adminPassword });
};

describe('delivery regression api', () => {
  const apiBase = getApiBase();
  const authBase = getAuthBase();

  it('should pass negative/boundary/regression scenarios', async () => {
    const authToken = await resolveAuthToken({ authBase });

    const projectCode = uniqueCode('PRJ-REG');

    const createResp = await request({
      base: apiBase,
      path: '/api/delivery/orders',
      method: 'POST',
      token: authToken,
      body: {
        project_code: projectCode,
        product_type: 'NDR',
        customer_name: 'RegressionCustomer',
        remark: 'vitest regression',
      },
    });
    ensureStatus(createResp, 201);
    const jobId = Number(ensureJsonField(createResp, 'id'));

    const assessResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/assess`,
      method: 'POST',
      token: authToken,
      body: { remark: '评估完成' },
    });
    ensureStatus(assessResp, 200);

    await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'IMPLEMENT',
      remark: 'implement evidence',
      content: `implement evidence ${Date.now()}`,
    });

    const implementFailResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/implement`,
      method: 'POST',
      token: authToken,
      body: {
        stage_payload: {
          cpu_match: 'FAIL',
          memory_match: 'PASS',
          disk_match: 'PASS',
          nic_match: 'PASS',
          serial_match: 'PASS',
        },
      },
    });
    ensureStatus(implementFailResp, 400);

    const implementSuccessResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/implement`,
      method: 'POST',
      token: authToken,
      body: {
        remark: '存在异常已说明',
        stage_payload: {
          cpu_match: 'FAIL',
          memory_match: 'PASS',
          disk_match: 'PASS',
          nic_match: 'PASS',
          serial_match: 'PASS',
          hardware_note: 'cpu型号不一致',
        },
      },
    });
    ensureStatus(implementSuccessResp, 200);

    await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'TUNE',
      remark: 'tune evidence',
      content: `tune evidence ${Date.now()}`,
    });

    const tuneFailResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/tune`,
      method: 'POST',
      token: authToken,
      body: {
        stage_payload: {
          os_version: '1.0.0',
          install_result: 'PASS',
        },
      },
    });
    ensureStatus(tuneFailResp, 400);

    const tuneSuccessResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/tune`,
      method: 'POST',
      token: authToken,
      body: {
        stage_payload: {
          os_name: 'JXOS',
          os_version: '1.0.0',
          install_result: 'PASS',
        },
      },
    });
    ensureStatus(tuneSuccessResp, 200);

    const trialAttachResp1 = await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'TRIAL',
      remark: 'trial evidence 1',
      content: `trial evidence 1 ${Date.now()}`,
    });
    const trialAttachId1 = Number(ensureJsonField(trialAttachResp1, 'id'));

    const trialResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${jobId}/phases/trial`,
      method: 'POST',
      token: authToken,
      body: {
        stage_payload: {
          boot_test: 'PASS',
          network_test: 'PASS',
          stress_test: 'PASS',
          test_result: 'PASS',
        },
      },
    });
    ensureStatus(trialResp, 200);

    const deleteLastTrialResp = await request({
      base: apiBase,
      path: `/api/delivery/attachments/${trialAttachId1}`,
      method: 'DELETE',
      token: authToken,
    });
    ensureStatus(deleteLastTrialResp, 409);

    const trialAttachResp2 = await uploadAttachment({
      apiBase,
      token: authToken,
      projectId: jobId,
      stageCode: 'TRIAL',
      remark: 'trial evidence 2',
      content: `trial evidence 2 ${Date.now()}`,
    });
    const trialAttachId2 = Number(ensureJsonField(trialAttachResp2, 'id'));

    const deleteTrialResp = await request({
      base: apiBase,
      path: `/api/delivery/attachments/${trialAttachId2}`,
      method: 'DELETE',
      token: authToken,
    });
    ensureStatus(deleteTrialResp, 200);

    const invalidDashboardResp = await request({
      base: apiBase,
      path: '/api/delivery/dashboard/summary?stage=INVALID',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(invalidDashboardResp, 400);

    const dashboardResp = await request({
      base: apiBase,
      path: '/api/delivery/dashboard/summary?stage=TRIAL&customer=RegressionCustomer&overdue_days=2',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(dashboardResp, 200);
    expect(String(dashboardResp.json.generated_at || '').length).toBeGreaterThan(0);

    const dashboardCsvResp = await request({
      base: apiBase,
      path: '/api/delivery/reports/dashboard.csv?stage=TRIAL&customer=RegressionCustomer&overdue_days=2',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(dashboardCsvResp, 200);
    expect(dashboardCsvResp.text.includes('交付单号')).toBe(true);

    const slaSummaryResp = await request({
      base: apiBase,
      path: '/api/delivery/sla/summary',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(slaSummaryResp, 200);
    expect(String(slaSummaryResp.json.generated_at || '').length).toBeGreaterThan(0);
    expect(Number(slaSummaryResp.json?.reminder_paging?.page || 0)).toBe(1);
    expect(Number(slaSummaryResp.json?.reminder_paging?.limit || 0)).toBe(10);
    expect(Number(slaSummaryResp.json?.reminder_paging?.total || 0)).toBeGreaterThanOrEqual(0);

    const slaSummaryPageResp = await request({
      base: apiBase,
      path: '/api/delivery/sla/summary?page=1&limit=5',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(slaSummaryPageResp, 200);
    expect(Number(slaSummaryPageResp.json?.reminder_paging?.limit || 0)).toBe(5);

    const slaRunResp = await request({
      base: apiBase,
      path: '/api/delivery/sla/run',
      method: 'POST',
      token: authToken,
      body: {
        max_scan: 100,
      },
    });
    ensureStatus(slaRunResp, 200);
    expect(Number(slaRunResp.json.checked || 0)).toBeGreaterThanOrEqual(0);

    const deleteInvalidReminderResp = await request({
      base: apiBase,
      path: '/api/delivery/sla/reminders/0',
      method: 'DELETE',
      token: authToken,
    });
    ensureStatus(deleteInvalidReminderResp, 400);

    const purgeReminderResp = await request({
      base: apiBase,
      path: '/api/delivery/sla/reminders',
      method: 'DELETE',
      token: authToken,
    });
    ensureStatus(purgeReminderResp, 200);
    expect(Number(purgeReminderResp.json?.deleted || 0)).toBeGreaterThanOrEqual(0);

    const verifyResp = await request({
      base: apiBase,
      path: '/api/delivery/audit/verify?limit=200',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(verifyResp, 200);
    expect(Number(verifyResp.json.total_checked || 0)).toBeGreaterThanOrEqual(0);

    const templateResp = await request({
      base: apiBase,
      path: '/api/delivery/templates/orders-import.xlsx',
      method: 'GET',
      token: authToken,
    });
    ensureStatus(templateResp, 200);

    const reportResp = await request({
      base: apiBase,
      path: `/api/delivery/reports/orders.xlsx?keyword=${encodeURIComponent(projectCode)}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(reportResp, 200);

    const batchCreateResp = await request({
      base: apiBase,
      path: '/api/delivery/orders',
      method: 'POST',
      token: authToken,
      body: {
        project_code: uniqueCode('PRJ-REG-BATCH'),
        product_type: 'WAF',
        customer_name: 'RegressionBatch',
        remark: 'batch-stage',
      },
    });
    ensureStatus(batchCreateResp, 201);
    const batchJobId = Number(ensureJsonField(batchCreateResp, 'id'));

    const batchStageResp = await request({
      base: apiBase,
      path: '/api/delivery/orders/batch/phase',
      method: 'POST',
      token: authToken,
      body: {
        action: 'assess',
        job_ids: [batchJobId],
        remark: 'batch assess',
        stage_payload: {
          receive_note: 'batch assess',
        },
      },
    });
    ensureStatus(batchStageResp, 200);
    expect(Number(batchStageResp.json.success_count || 0)).toBe(1);

    const batchDetailResp = await request({
      base: apiBase,
      path: `/api/delivery/orders/${batchJobId}`,
      method: 'GET',
      token: authToken,
    });
    ensureStatus(batchDetailResp, 200);
    expect(batchDetailResp.json.current_stage).toBe('ASSESS');
  });
});

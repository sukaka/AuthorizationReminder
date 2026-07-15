import { expect, test, type Page, type Route } from '@playwright/test';

type LifecycleStatus = 'draft' | 'pending_approval' | 'approved' | 'delivered' | 'archived';

type RecordedMutation = {
  action: 'review' | 'submit' | 'approve' | 'export' | 'deliver' | 'archive';
  body: Record<string, unknown>;
};

type ProfessionalFlowState = {
  lifecycleStatus: LifecycleStatus;
  rowVersion: number;
  submitted: boolean;
  review: Record<string, unknown> | null;
  mutations: RecordedMutation[];
};

const deliverableUuid = 'deliverable-1';
const versionUuid = 'version-2';
const contentHash = 'a'.repeat(64);
const createdAt = '2026-07-15T08:00:00+08:00';

const currentVersion = {
  version_uuid: versionUuid,
  version_no: 2,
  parent_version_uuid: 'version-1',
  skill_version_uuid: 'skill-security-monthly-report-v1',
  template_version_uuid: 'template-security-monthly-report-v1',
  title_snapshot: '安全运营月报（六月）',
  summary_snapshot: '本月安全运营总体稳定，重大事件均已闭环。',
  change_summary: '补充处置复盘与下月计划',
  creation_reason: 'professional_run',
  content: {
    schema_version: '1',
    blocks: [
      { block_id: 'monthly-overview', type: 'paragraph', text: '本月安全运营总体稳定。' },
      { block_id: 'operations-metrics', type: 'paragraph', text: '本月完成十二次安全巡检。' },
      { block_id: 'major-incidents', type: 'paragraph', text: '重大事件均已闭环。' },
      { block_id: 'risks-and-plans', type: 'paragraph', text: '下月完成权限基线复核。' },
    ],
  },
  content_hash: contentHash,
  created_at: createdAt,
};

function allowedActions(status: LifecycleStatus, submitted: boolean): string[] {
  switch (status) {
    case 'draft':
      return ['edit', 'review', 'export', 'manage_facts', 'reply_comment', 'update_metadata'];
    case 'pending_approval':
      return submitted
        ? ['approve', 'request_changes', 'export', 'reply_comment', 'update_metadata']
        : ['submit', 'export', 'reply_comment', 'update_metadata'];
    case 'approved':
      return ['create_revision', 'deliver', 'export', 'reply_comment', 'submit_experience', 'update_metadata'];
    case 'delivered':
      return ['archive', 'reply_comment', 'submit_experience', 'update_metadata'];
    case 'archived':
      return ['reply_comment', 'submit_experience'];
  }
}

function deliverableDetail(state: ProfessionalFlowState) {
  return {
    request_id: `detail-${state.rowVersion}`,
    deliverable_uuid: deliverableUuid,
    title: '安全运营月报（六月）',
    deliverable_type: 'security_monthly_report',
    scope_type: 'personal',
    formality: 'formal',
    project_uuid: null,
    owner_user_id: 'u-professional-e2e',
    lifecycle_status: state.lifecycleStatus,
    row_version: state.rowVersion,
    content_summary: currentVersion.summary_snapshot,
    allowed_actions: allowedActions(state.lifecycleStatus, state.submitted),
    current_version: currentVersion,
    source_change_notice: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function approvalEvent(eventType: string, before: number, after: number) {
  return {
    event_uuid: `event-${eventType}`,
    event_type: eventType,
    version_uuid: versionUuid,
    approval_flow_version_uuid: 'personal-flow-v1',
    content_hash: contentHash,
    actor_user_id: 'u-professional-e2e',
    comment_uuids: [],
    row_version_before: before,
    row_version_after: after,
    created_at: createdAt,
  };
}

function parseBody(route: Route): Record<string, unknown> {
  const raw = route.request().postData();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function mockProfessionalApi(page: Page, state: ProfessionalFlowState) {
  await page.route('**/api/ai/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/ai/session') {
      return route.fulfill({ json: {
        user: { id: 'u-professional-e2e', username: '专业交付员工', role: 'employee' },
        scope: { department: '安全运营部', managedDepartments: [] },
        apps: ['ai-assistant'],
        local_binding_token: 'professional-e2e-binding-token',
      } });
    }
    if (path === '/api/ai/home') {
      return route.fulfill({ json: {
        favorites: [], recent_tasks: [], recent_generations: [],
        safety_reminders: ['正式成果必须通过质量门禁后交付'],
      } });
    }
    if (path === '/api/ai/deliverables' && method === 'GET') {
      const detail = deliverableDetail(state);
      return route.fulfill({ json: {
        request_id: 'deliverables-list',
        items: [{
          deliverable_uuid: detail.deliverable_uuid,
          title: detail.title,
          deliverable_type: detail.deliverable_type,
          scope_type: detail.scope_type,
          formality: detail.formality,
          project_uuid: detail.project_uuid,
          owner_user_id: detail.owner_user_id,
          lifecycle_status: detail.lifecycle_status,
          row_version: detail.row_version,
          content_summary: detail.content_summary,
          allowed_actions: detail.allowed_actions,
          created_at: detail.created_at,
          updated_at: detail.updated_at,
        }],
        total: 1,
        page: 1,
        page_size: 50,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}` && method === 'GET') {
      return route.fulfill({ json: deliverableDetail(state) });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/evidence/refresh` && method === 'POST') {
      return route.fulfill({ json: {
        request_id: 'evidence-refresh',
        deliverable_uuid: deliverableUuid,
        lifecycle_status: state.lifecycleStatus,
        row_version: state.rowVersion,
        invalidated_evidence_uuids: [],
        source_change_notice: null,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/versions` && method === 'GET') {
      return route.fulfill({ json: {
        request_id: 'version-list',
        deliverable_uuid: deliverableUuid,
        items: [{
          version_uuid: versionUuid,
          version_no: 2,
          parent_version_uuid: 'version-1',
          skill_version_uuid: currentVersion.skill_version_uuid,
          template_version_uuid: currentVersion.template_version_uuid,
          title_snapshot: currentVersion.title_snapshot,
          summary_snapshot: currentVersion.summary_snapshot,
          change_summary: currentVersion.change_summary,
          creation_reason: currentVersion.creation_reason,
          content_hash: contentHash,
          created_at: createdAt,
          is_current: true,
        }],
        total: 1,
        page: 1,
        page_size: 50,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/versions/${versionUuid}/facts` && method === 'GET') {
      return route.fulfill({ json: {
        request_id: 'fact-list', deliverable_uuid: deliverableUuid, version_uuid: versionUuid,
        content_hash: contentHash, items: [], total: 0,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/reviews` && method === 'GET') {
      return route.fulfill({ json: {
        request_id: 'review-list', items: state.review ? [state.review] : [],
        total: state.review ? 1 : 0, page: 1, page_size: 50,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/comments` && method === 'GET') {
      return route.fulfill({ json: {
        request_id: 'comment-list', deliverable_uuid: deliverableUuid, items: [], total: 0,
      } });
    }
    if (path === '/api/ai/approval-flows' && method === 'GET') {
      return route.fulfill({ json: {
        request_id: 'approval-flows',
        items: [{
          flow_uuid: 'personal-flow',
          flow_key: 'personal-formal-delivery',
          name: '个人正式成果审批',
          scope_policy: 'personal',
          deliverable_types: ['*'],
          status: 'published',
          current_version: {
            version_uuid: 'personal-flow-v1',
            version: 1,
            content_hash: 'b'.repeat(64),
            steps: [{ step_key: 'owner', name: '成果确认', roles: ['employee'], required_approvals: 1 }],
            min_approvals: 1,
            allow_author_approve: true,
            reminder_config: {},
            return_target: 'author',
            status: 'published',
            published_at: createdAt,
          },
        }],
        total: 1,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/reviews` && method === 'POST') {
      const body = parseBody(route);
      state.mutations.push({ action: 'review', body });
      const categories = [
        'structure_contract', 'facts_evidence', 'project_scope', 'consistency',
        'professional_rules', 'format_expression', 'sensitive_security',
      ].map((category) => ({
        category, status: 'passed', rule_count: 1, issue_count: 0,
        blocking_issue_count: 0, duration_ms: 2,
      }));
      state.review = {
        review_uuid: 'review-v2',
        version_uuid: versionUuid,
        version_no: 2,
        content_hash: contentHash,
        status: 'passed',
        gates_passed: true,
        total_score: 100,
        rule_version_uuids: categories.map(({ category }) => `rule-${category}-v1`),
        category_results: categories,
        issues: [],
        initiated_by: 'u-professional-e2e',
        completed_at: createdAt,
        created_at: createdAt,
      };
      state.lifecycleStatus = 'pending_approval';
      state.rowVersion = 6;
      state.submitted = false;
      return route.fulfill({ json: {
        request_id: 'review-create',
        deliverable_uuid: deliverableUuid,
        lifecycle_status: state.lifecycleStatus,
        row_version: state.rowVersion,
        review: state.review,
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/submit` && method === 'POST') {
      const body = parseBody(route);
      state.mutations.push({ action: 'submit', body });
      const before = state.rowVersion;
      state.rowVersion = before + 1;
      state.submitted = true;
      return route.fulfill({ json: {
        request_id: 'approval-submit', deliverable_uuid: deliverableUuid,
        lifecycle_status: 'pending_approval', row_version: state.rowVersion,
        event: approvalEvent('submitted', before, state.rowVersion),
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/approve` && method === 'POST') {
      const body = parseBody(route);
      state.mutations.push({ action: 'approve', body });
      const before = state.rowVersion;
      state.lifecycleStatus = 'approved';
      state.rowVersion = before + 1;
      return route.fulfill({ json: {
        request_id: 'approval-approved', deliverable_uuid: deliverableUuid,
        lifecycle_status: state.lifecycleStatus, row_version: state.rowVersion,
        event: approvalEvent('approved', before, state.rowVersion),
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/versions/${versionUuid}/exports` && method === 'POST') {
      const body = parseBody(route);
      state.mutations.push({ action: 'export', body });
      return route.fulfill({ json: {
        request_id: 'export-create',
        deliverable_uuid: deliverableUuid,
        export_uuid: 'export-v2',
        version_uuid: versionUuid,
        version_no: 2,
        content_hash: contentHash,
        export_format: 'docx',
        status: 'ready',
        watermarked: false,
        file_name: '安全运营月报-六月-V2.docx',
        file_hash: 'c'.repeat(64),
        file_size: 128,
        renderer_version: 'professional-docx-v1',
        download_url: '/api/ai/exports/export-v2/download',
        created_by: 'u-professional-e2e',
        created_at: createdAt,
      } });
    }
    if (path === '/api/ai/exports/export-v2/download' && method === 'GET') {
      return route.fulfill({
        body: 'PK\u0003\u0004professional-delivery-e2e',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        headers: { 'Content-Disposition': "attachment; filename*=UTF-8''%E5%AE%89%E5%85%A8%E8%BF%90%E8%90%A5%E6%9C%88%E6%8A%A5-%E5%85%AD%E6%9C%88-V2.docx" },
      });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/deliver` && method === 'POST') {
      const body = parseBody(route);
      state.mutations.push({ action: 'deliver', body });
      state.lifecycleStatus = 'delivered';
      state.rowVersion += 1;
      return route.fulfill({ json: {
        request_id: 'delivery-create', deliverable_uuid: deliverableUuid,
        lifecycle_status: state.lifecycleStatus, row_version: state.rowVersion,
        delivery: {
          delivery_uuid: 'delivery-v2', version_uuid: versionUuid, export_uuid: 'export-v2',
          content_hash: contentHash, delivered_by: 'u-professional-e2e',
          recipient_description: body.recipient_description, note: body.note, delivered_at: createdAt,
        },
      } });
    }
    if (path === `/api/ai/deliverables/${deliverableUuid}/archive` && method === 'POST') {
      const body = parseBody(route);
      state.mutations.push({ action: 'archive', body });
      const before = state.rowVersion;
      state.lifecycleStatus = 'archived';
      state.rowVersion = before + 1;
      return route.fulfill({ json: {
        request_id: 'delivery-archive', deliverable_uuid: deliverableUuid,
        lifecycle_status: state.lifecycleStatus, row_version: state.rowVersion,
        event: approvalEvent('archived', before, state.rowVersion),
      } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${method} ${path}` } });
  });
}

test('formal deliverable passes review, approval, exact-version export, delivery and archive', async ({ page }) => {
  const state: ProfessionalFlowState = {
    lifecycleStatus: 'draft', rowVersion: 5, submitted: false, review: null, mutations: [],
  };
  await mockProfessionalApi(page, state);
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto('/');

  await page.getByRole('button', { name: '成果中心' }).click();
  await expect(page.getByRole('heading', { name: '安全运营月报（六月）' })).toBeVisible();
  await expect(page.locator('.professional-workbench-header [data-status="draft"]')).toHaveText('草稿');

  await page.getByRole('button', { name: '运行质量审阅' }).click();
  await expect(page.getByRole('status')).toHaveText('质量审阅通过');
  await expect(page.getByText('质量门禁通过')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交审批' })).toBeEnabled();

  await page.getByRole('button', { name: '提交审批' }).click();
  await expect(page.getByRole('status')).toHaveText('已提交审批');
  await expect(page.getByRole('button', { name: '批准当前版本' })).toBeVisible();

  await page.getByRole('button', { name: '批准当前版本' }).click();
  await expect(page.getByRole('status')).toHaveText('当前版本已批准');
  await expect(page.locator('.professional-workbench-header [data-status="approved"]')).toHaveText('已批准');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Word' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('安全运营月报-六月-V2.docx');
  await expect(page.getByRole('status')).toHaveText('已导出 安全运营月报-六月-V2.docx');

  await page.getByRole('tab', { name: '动态' }).click();
  await page.getByLabel('交付接收方').fill('信息安全委员会');
  await page.getByLabel('交付说明').fill('月度例会正式审阅材料');
  await page.getByRole('button', { name: '确认交付' }).click();
  await expect(page.getByRole('status')).toHaveText('成果已交付并锁定交付版本');
  await expect(page.locator('.professional-workbench-header [data-status="delivered"]')).toHaveText('已交付');

  await page.getByRole('button', { name: '归档交付成果' }).click();
  await expect(page.getByRole('status')).toHaveText('成果已归档');
  await expect(page.locator('.professional-workbench-header [data-status="archived"]')).toHaveText('已归档');

  expect(state.mutations).toEqual([
    { action: 'review', body: { row_version: 5, version_uuid: versionUuid, content_hash: contentHash } },
    {
      action: 'submit',
      body: {
        row_version: 6, version_uuid: versionUuid, content_hash: contentHash,
        approval_flow_version_uuid: 'personal-flow-v1',
      },
    },
    { action: 'approve', body: { row_version: 7, version_uuid: versionUuid, content_hash: contentHash } },
    {
      action: 'export',
      body: { row_version: 8, content_hash: contentHash, export_format: 'docx' },
    },
    {
      action: 'deliver',
      body: {
        row_version: 8, version_uuid: versionUuid, content_hash: contentHash,
        export_uuid: 'export-v2', recipient_description: '信息安全委员会', note: '月度例会正式审阅材料',
      },
    },
    {
      action: 'archive',
      body: {
        row_version: 9, version_uuid: versionUuid, content_hash: contentHash,
        delivery_uuid: 'delivery-v2',
      },
    },
  ]);
});

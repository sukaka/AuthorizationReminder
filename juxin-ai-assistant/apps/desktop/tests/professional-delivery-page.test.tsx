import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import { ProfessionalDeliverablesPage } from '../src/pages/ProfessionalDeliverablesPage';
import { ProfessionalTasksPage } from '../src/pages/ProfessionalTasksPage';
import { server } from './setup';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const projects = [
  {
    project_uuid: 'project-a',
    name: '甲方安全运营项目',
    description: '安全运营与月度汇报',
    status: 'active',
    owner_user_id: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  },
  {
    project_uuid: 'project-b',
    name: '乙方巡检项目',
    description: '隔离的另一个项目',
    status: 'active',
    owner_user_id: 'user-1',
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  },
];

const skillList = {
  request_id: 'req-skills',
  items: [{
    skill_uuid: 'skill-security',
    skill_key: 'security_ops_monthly_report',
    name: '安全运营月报',
    category: 'professional_delivery',
    description: '将项目事实整理为可审阅的安全运营月报。',
    scope_policy: 'project',
    status: 'published',
    current_version: {
      version_uuid: 'skill-version-1',
      version: 1,
      content_hash: 'skill-hash-1',
      status: 'published',
      default_template_version_uuid: 'template-version-1',
      published_at: '2026-07-14T00:00:00Z',
    },
  }],
  total: 1,
};

const templateList = {
  request_id: 'req-templates',
  items: [{
    template_uuid: 'template-security',
    template_key: 'security_ops_monthly_report',
    name: '安全运营月报标准模板',
    purpose: '专业交付版四段式月报模板。',
    deliverable_types: ['security_ops_monthly_report'],
    scope_type: 'project',
    status: 'published',
    current_version: {
      version_uuid: 'template-version-1',
      version: 1,
      content_hash: 'template-hash-1',
      status: 'published',
      published_at: '2026-07-14T00:00:00Z',
    },
  }],
  total: 1,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => undefined);
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });

  server.use(
    http.get('/api/ai/projects', () => HttpResponse.json(projects)),
    http.get('/api/ai/projects/project-a/files', () => HttpResponse.json([{
      file_uuid: 'file-a',
      project_file_uuid: 'project-file-a',
      file_name: '2026-06-security-log.xlsx',
      file_type: 'xlsx',
      category: 'security_log',
      summary: '六月安全日志',
      status: 'active',
      linked_by: 'user-1',
      created_at: '2026-07-01T00:00:00Z',
    }])),
    http.get('/api/ai/projects/project-b/files', () => HttpResponse.json([{
      file_uuid: 'file-b',
      project_file_uuid: 'project-file-b',
      file_name: 'inspection.pdf',
      file_type: 'pdf',
      category: 'inspection',
      summary: '巡检材料',
      status: 'active',
      linked_by: 'user-1',
      created_at: '2026-07-02T00:00:00Z',
    }])),
    http.get('/api/ai/skills', () => HttpResponse.json(skillList)),
    http.get('/api/ai/templates', () => HttpResponse.json(templateList)),
    http.post('/api/ai/deliverables/:deliverableUuid/evidence/refresh', ({ params }) => HttpResponse.json({
      request_id: 'req-refresh',
      deliverable_uuid: String(params.deliverableUuid),
      lifecycle_status: 'draft',
      row_version: 1,
      invalidated_evidence_uuids: [],
      source_change_notice: null,
    })),
  );
});

it('shows the recommended skill and clears project resources when switching projects', async () => {
  render(<ProfessionalTasksPage />);

  expect(await screen.findByRole('heading', { name: '专业任务' })).toBeInTheDocument();
  expect(await screen.findByText('安全运营月报')).toBeInTheDocument();
  expect(await screen.findByText('推荐原因：与当前交付类型和项目范围匹配')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('所属项目'), 'project-a');
  const fileA = await screen.findByRole('checkbox', { name: /2026-06-security-log\.xlsx/ });
  await userEvent.click(fileA);
  expect(fileA).toBeChecked();

  await userEvent.selectOptions(screen.getByLabelText('所属项目'), 'project-b');
  expect(await screen.findByText('已切换项目，原项目的附件选择已清空。')).toBeInTheDocument();
  expect(await screen.findByRole('checkbox', { name: /inspection\.pdf/ })).not.toBeChecked();
});

it('blocks monthly-report generation until the required period is supplied', async () => {
  const createRequest = vi.fn();
  server.use(
    http.post('/api/ai/deliverables', async ({ request }) => {
      createRequest(await request.json());
      return HttpResponse.json({}, { status: 201 });
    }),
  );

  render(<ProfessionalTasksPage />);
  await userEvent.selectOptions(await screen.findByLabelText('所属项目'), 'project-a');
  await userEvent.click(screen.getByRole('button', { name: '生成专业月报' }));

  expect(await screen.findByText('缺少：报告周期')).toBeInTheDocument();
  expect(createRequest).not.toHaveBeenCalled();
});

it('restores a waiting professional task and supplies its missing input', async () => {
  const suppliedInput = vi.fn();
  window.sessionStorage.setItem('juxin-professional-active-run', JSON.stringify({
    runUuid: 'run-recover',
    deliverableUuid: 'deliverable-recover',
    projectUuid: 'project-a',
    profileId: '',
    period: '',
  }));
  const detail = {
    run: {
      run_id: 'run-recover',
      title: '安全运营月报专业任务',
      run_type: 'professional_delivery',
      status: 'waiting_confirmation',
      stage: 'executing',
      progress: 25,
      artifact: null,
      citations: [],
      created_at: '2026-07-15T01:00:00Z',
      updated_at: '2026-07-15T01:00:01Z',
    },
    steps: [],
    events: [],
    result: {},
    professional: {
      run_uuid: 'run-recover',
      deliverable_uuid: 'deliverable-recover',
      status: 'waiting_for_input',
      phase: 'completeness',
      source_version_uuid: 'source-version-1',
      skill_version_uuid: 'skill-version-1',
      template_version_uuid: 'template-version-1',
      context_hash: 'a'.repeat(64),
      missing_fields: ['period'],
      pending_model_request: null,
      created_version_uuid: null,
      allowed_actions: ['supply_input', 'cancel'],
      stages: [{
        key: 'completeness',
        label: '检查输入完整性',
        status: 'waiting',
        duration_ms: 1200,
        summary: '等待补充必要输入',
        recover_action: 'supply_input',
      }],
    },
  };
  server.use(
    http.get('/api/ai/runs/run-recover', () => HttpResponse.json(detail)),
    http.get('/api/ai/runs/run-recover/events', () => new HttpResponse(
      `data: ${JSON.stringify({
        event_id: 'event-recover', run_id: 'run-recover', sequence: 1,
        event_type: 'failed', stage: 'failed', label: '连接快照已结束', progress: 25,
        content: '', source: null, artifact_id: '', quality: null,
      })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )),
    http.post('/api/ai/runs/run-recover/input', async ({ request }) => {
      suppliedInput(await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({
        run_uuid: 'run-recover',
        deliverable_uuid: 'deliverable-recover',
        status: 'waiting_for_input',
        phase: 'completeness',
        source_version_uuid: 'source-version-1',
        skill_version_uuid: 'skill-version-1',
        template_version_uuid: 'template-version-1',
        context_hash: 'a'.repeat(64),
        missing_fields: ['objective'],
        pending_model_request: null,
        created_version: null,
        replayed: false,
      }, { status: 202 });
    }),
  );

  render(<ProfessionalTasksPage />);

  expect(await screen.findByText('等待补充必要输入')).toBeInTheDocument();
  expect(screen.getByText('1.2 秒')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('恢复任务：报告周期'), '2026-07');
  await userEvent.click(screen.getByRole('button', { name: '补充并继续' }));

  await waitFor(() => expect(suppliedInput).toHaveBeenCalledWith(
    { inputs: { period: '2026-07' } },
    expect.stringMatching(/^professional-run-input-/),
  ));
});

it('cancels a recoverable task while preserving its existing draft', async () => {
  let cancelled = false;
  const cancelRequest = vi.fn();
  window.sessionStorage.setItem('juxin-professional-active-run', JSON.stringify({
    runUuid: 'run-cancel',
    deliverableUuid: 'deliverable-cancel',
    projectUuid: 'project-a',
    profileId: '',
    period: '2026-07',
  }));
  server.use(
    http.get('/api/ai/runs/run-cancel', () => HttpResponse.json({
      run: {
        run_id: 'run-cancel', title: '安全运营月报专业任务', run_type: 'professional_delivery',
        status: cancelled ? 'cancelled' : 'waiting_confirmation',
        stage: cancelled ? 'cancelled' : 'executing', progress: 70,
        artifact: null, citations: [], created_at: null, updated_at: null,
      },
      steps: [], events: [], result: {},
      professional: {
        run_uuid: 'run-cancel', deliverable_uuid: 'deliverable-cancel',
        status: cancelled ? 'cancelled' : 'waiting_for_model', phase: 'draft',
        source_version_uuid: 'source-version-1', skill_version_uuid: 'skill-version-1',
        template_version_uuid: 'template-version-1', context_hash: 'a'.repeat(64),
        missing_fields: [], pending_model_request: cancelled ? null : {
          step_uuid: 'step-draft', request_hash: 'b'.repeat(64), one_time_token: null,
          model_profile_uuid: 'profile-local', system_prompt: 'system', instructions: [],
          inputs: {}, output_schema: {}, context: {},
        },
        created_version_uuid: null,
        allowed_actions: cancelled ? [] : ['resume', 'cancel'],
        stages: [{
          key: 'draft', label: '生成专业草稿', status: cancelled ? 'cancelled' : 'waiting',
          duration_ms: 320, summary: cancelled ? '任务已取消，已有材料与草稿已保留' : '等待恢复本地模型步骤',
          recover_action: cancelled ? null : 'resume',
        }],
      },
    })),
    http.get('/api/ai/runs/run-cancel/events', () => new HttpResponse(
      `data: ${JSON.stringify({
        event_id: 'event-cancel', run_id: 'run-cancel', sequence: 1,
        event_type: 'completed', stage: 'completed', label: '连接快照已结束', progress: 70,
        content: '', source: null, artifact_id: '', quality: null,
      })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )),
    http.post('/api/ai/runs/run-cancel/cancel', () => {
      cancelled = true;
      cancelRequest();
      return HttpResponse.json({
        run_id: 'run-cancel', title: '安全运营月报专业任务', run_type: 'professional_delivery',
        status: 'cancelled', stage: 'cancelled', progress: 70,
        artifact: null, citations: [], created_at: null, updated_at: null,
      });
    }),
  );

  render(<ProfessionalTasksPage />);

  await userEvent.click(await screen.findByRole('button', { name: '停止任务' }));
  await waitFor(() => expect(cancelRequest).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('任务已取消；已有材料与草稿已保留。')).toBeInTheDocument();
  expect(await screen.findByText('任务已取消，已有材料与草稿已保留')).toBeInTheDocument();
});

it('renders a three-column deliverable workbench and saves an immutable version', async () => {
  const createVersion = vi.fn();
  const detail = {
    request_id: 'req-detail',
    deliverable_uuid: 'deliverable-1',
    title: '2026 年 6 月安全运营月报',
    deliverable_type: 'security_ops_monthly_report',
    scope_type: 'project',
    formality: 'formal',
    project_uuid: 'project-a',
    owner_user_id: 'user-1',
    lifecycle_status: 'draft',
    row_version: 2,
    content_summary: '六月安全运营情况',
    allowed_actions: ['edit', 'review', 'export'],
    current_version: {
      version_uuid: 'version-2',
      version_no: 2,
      parent_version_uuid: 'version-1',
      skill_version_uuid: 'skill-version-1',
      template_version_uuid: 'template-version-1',
      title_snapshot: '2026 年 6 月安全运营月报',
      summary_snapshot: '六月安全运营情况',
      change_summary: 'AI 生成专业初稿',
      creation_reason: 'professional_run',
      content: {
        schema_version: '1',
        blocks: [
          { block_id: 'overview', type: 'heading', text: '本月概览' },
          { block_id: 'overview-body', type: 'paragraph', text: '本月完成例行安全运营。' },
        ],
      },
      content_hash: 'hash-version-2',
      created_at: '2026-07-14T08:00:00Z',
    },
    created_at: '2026-07-14T08:00:00Z',
    updated_at: '2026-07-14T08:00:00Z',
  };

  server.use(
    http.get('/api/ai/deliverables', () => HttpResponse.json({
      request_id: 'req-list',
      items: [{
        deliverable_uuid: 'deliverable-1',
        title: detail.title,
        deliverable_type: detail.deliverable_type,
        scope_type: detail.scope_type,
        formality: detail.formality,
        project_uuid: detail.project_uuid,
        lifecycle_status: detail.lifecycle_status,
        row_version: detail.row_version,
        content_summary: detail.content_summary,
        updated_at: detail.updated_at,
      }],
      total: 1,
      page: 1,
      page_size: 50,
    })),
    http.get('/api/ai/deliverables/deliverable-1', () => HttpResponse.json(detail)),
    http.get('/api/ai/deliverables/deliverable-1/versions', () => HttpResponse.json({
      request_id: 'req-versions',
      deliverable_uuid: 'deliverable-1',
      items: [{
        version_uuid: 'version-2',
        version_no: 2,
        change_summary: 'AI 生成专业初稿',
        creation_reason: 'professional_run',
        content_hash: 'hash-version-2',
        created_at: '2026-07-14T08:00:00Z',
      }],
      total: 1,
      page: 1,
      page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-1/versions/version-2/facts', () => HttpResponse.json({
      request_id: 'req-facts',
      deliverable_uuid: 'deliverable-1',
      version_uuid: 'version-2',
      content_hash: 'hash-version-2',
      items: [],
      total: 0,
    })),
    http.get('/api/ai/deliverables/deliverable-1/reviews', () => HttpResponse.json({
      request_id: 'req-reviews', items: [], total: 0, page: 1, page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-1/comments', () => HttpResponse.json({
      request_id: 'req-comments', items: [], total: 0,
    })),
    http.post('/api/ai/deliverables/deliverable-1/versions', async ({ request }) => {
      createVersion(await request.json());
      return HttpResponse.json({
        request_id: 'req-version-3',
        deliverable_uuid: 'deliverable-1',
        version: {
          ...detail.current_version,
          version_uuid: 'version-3',
          version_no: 3,
          parent_version_uuid: 'version-2',
          change_summary: '人工修订',
          content_hash: 'hash-version-3',
        },
      }, { status: 201 });
    }),
  );

  const { container } = render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-1" />);

  expect(await screen.findByRole('heading', { name: detail.title })).toBeInTheDocument();
  const workbench = container.querySelector('.professional-delivery-layout');
  expect(workbench).toBeInTheDocument();
  expect(workbench?.children).toHaveLength(3);
  expect(within(workbench as HTMLElement).getByText('事实与证据')).toBeInTheDocument();

  const editor = screen.getByLabelText('成果正文');
  await userEvent.clear(editor);
  await userEvent.type(editor, '本月完成安全运营并闭环全部高风险事件。');
  await userEvent.click(screen.getByRole('button', { name: '保存为新版本' }));

  await waitFor(() => expect(createVersion).toHaveBeenCalledWith(expect.objectContaining({
    row_version: 2,
    parent_version_uuid: 'version-2',
    change_summary: '人工修订',
  })));
  expect(await screen.findByText('已保存为版本 V3')).toBeInTheDocument();
});

it('exposes a recoverable autosave conflict instead of failing silently', async () => {
  const draftContent = {
    schema_version: '2',
    blocks: [{ block_id: 'body', type: 'paragraph', text: '可编辑的草稿正文。' }],
  };
  const immutableContent = {
    schema_version: '2',
    blocks: [{ block_id: 'body', type: 'paragraph', text: '服务器上的最新正文。' }],
  };
  const detail = {
    request_id: 'req-conflict-detail',
    deliverable_uuid: 'deliverable-conflict',
    title: '冲突恢复测试成果',
    deliverable_type: 'security_ops_monthly_report',
    scope_type: 'personal',
    formality: 'formal',
    project_uuid: null,
    owner_user_id: 'user-1',
    lifecycle_status: 'draft',
    row_version: 4,
    content_summary: '可编辑的草稿正文。',
    allowed_actions: ['edit', 'review', 'export'],
    current_version: {
      version_uuid: 'version-conflict',
      version_no: 1,
      parent_version_uuid: null,
      skill_version_uuid: 'skill-version-1',
      template_version_uuid: 'template-version-1',
      title_snapshot: '冲突恢复测试成果',
      summary_snapshot: '可编辑的草稿正文。',
      change_summary: '专业任务生成',
      creation_reason: 'professional_run',
      content: immutableContent,
      content_hash: 'conflict-hash',
      created_at: '2026-07-15T02:00:00Z',
    },
    created_at: '2026-07-15T02:00:00Z',
    updated_at: '2026-07-15T02:00:00Z',
  };
  const saveDraft = vi.fn();
  server.use(
    http.get('/api/ai/deliverables', () => HttpResponse.json({
      request_id: 'req-conflict-list',
      items: [detail],
      total: 1,
      page: 1,
      page_size: 50,
    })),
    http.post('/api/ai/deliverables/deliverable-conflict/evidence/refresh', () => HttpResponse.json({
      request_id: 'req-conflict-refresh',
      deliverable_uuid: 'deliverable-conflict',
      lifecycle_status: 'draft',
      row_version: 4,
      invalidated_evidence_uuids: [],
      source_change_notice: null,
    })),
    http.get('/api/ai/deliverables/deliverable-conflict', () => HttpResponse.json(detail)),
    http.get('/api/ai/deliverables/deliverable-conflict/draft', () => HttpResponse.json({
      request_id: 'req-conflict-draft',
      deliverable_uuid: 'deliverable-conflict',
      draft_uuid: 'draft-conflict',
      base_version_uuid: 'version-conflict',
      row_version: 4,
      draft_revision: 2,
      content: draftContent,
      content_hash: 'draft-hash',
      content_summary: '可编辑的草稿正文。',
      updated_by: 'user-1',
      updated_at: '2026-07-15T02:00:00Z',
    })),
    http.post('/api/ai/deliverables/deliverable-conflict/draft/lease', () => HttpResponse.json({
      request_id: 'req-conflict-lease',
      deliverable_uuid: 'deliverable-conflict',
      lease_uuid: 'lease-conflict',
      owner_user_id: 'user-1',
      fencing_token: 9,
      expires_at: '2026-07-15T03:00:00Z',
    })),
    http.put('/api/ai/deliverables/deliverable-conflict/draft', async ({ request }) => {
      saveDraft(await request.json());
      return HttpResponse.json({ code: 'DRAFT_ROW_VERSION_CONFLICT' }, { status: 409 });
    }),
    http.get('/api/ai/deliverables/deliverable-conflict/versions', () => HttpResponse.json({
      request_id: 'req-conflict-versions',
      deliverable_uuid: 'deliverable-conflict',
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-conflict/versions/version-conflict/facts', () => HttpResponse.json({
      request_id: 'req-conflict-facts',
      deliverable_uuid: 'deliverable-conflict',
      version_uuid: 'version-conflict',
      content_hash: 'conflict-hash',
      items: [],
      total: 0,
    })),
    http.get('/api/ai/deliverables/deliverable-conflict/reviews', () => HttpResponse.json({
      request_id: 'req-conflict-reviews',
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-conflict/comments', () => HttpResponse.json({
      request_id: 'req-conflict-comments',
      items: [],
      total: 0,
    })),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-conflict" />);
  expect(await screen.findByRole('heading', { name: detail.title })).toBeInTheDocument();

  const editor = screen.getByLabelText('成果正文');
  await userEvent.clear(editor);
  await userEvent.type(editor, '这次修改会触发冲突。');

  await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  expect(await screen.findByText('草稿冲突，需刷新')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '刷新恢复' })).toBeInTheDocument();
  expect(await screen.findByText('草稿保存冲突，请刷新后恢复最新内容。')).toBeInTheDocument();
});

it('shows a source-change audit notice without changing the delivered snapshot', async () => {
  const refreshRequest = vi.fn();
  const deliveredDetail = {
    request_id: 'req-delivered-detail',
    deliverable_uuid: 'deliverable-delivered',
    title: '已交付安全运营月报',
    deliverable_type: 'security_ops_monthly_report',
    scope_type: 'personal',
    formality: 'formal',
    project_uuid: null,
    owner_user_id: 'user-1',
    lifecycle_status: 'delivered',
    row_version: 6,
    content_summary: '已交付版本快照',
    allowed_actions: ['create_revision', 'export', 'archive'],
    current_version: {
      version_uuid: 'version-delivered',
      version_no: 4,
      parent_version_uuid: 'version-3',
      skill_version_uuid: 'skill-version-1',
      template_version_uuid: 'template-version-1',
      title_snapshot: '已交付安全运营月报',
      summary_snapshot: '已交付版本快照',
      change_summary: '正式定稿',
      creation_reason: 'manual_edit',
      content: {
        schema_version: '1',
        blocks: [{ block_id: 'snapshot', type: 'paragraph', text: '交付正文保持不变。' }],
      },
      content_hash: 'd'.repeat(64),
      created_at: '2026-07-14T08:00:00Z',
    },
    source_change_notice: {
      message: '来源后续已变化',
      affected_evidence_count: 1,
      historical_snapshot_preserved: true,
    },
    created_at: '2026-07-14T08:00:00Z',
    updated_at: '2026-07-15T08:00:00Z',
  };

  server.use(
    http.get('/api/ai/deliverables', () => HttpResponse.json({
      request_id: 'req-delivered-list', items: [deliveredDetail], total: 1, page: 1, page_size: 50,
    })),
    http.post('/api/ai/deliverables/deliverable-delivered/evidence/refresh', ({ request }) => {
      refreshRequest(request.headers.get('Idempotency-Key'));
      return HttpResponse.json({
        request_id: 'req-refresh-delivered',
        deliverable_uuid: deliveredDetail.deliverable_uuid,
        lifecycle_status: 'delivered',
        row_version: 6,
        invalidated_evidence_uuids: ['evidence-stale'],
        source_change_notice: deliveredDetail.source_change_notice,
      });
    }),
    http.get('/api/ai/deliverables/deliverable-delivered', () => HttpResponse.json(deliveredDetail)),
    http.get('/api/ai/deliverables/deliverable-delivered/versions', () => HttpResponse.json({
      request_id: 'req-delivered-versions', deliverable_uuid: deliveredDetail.deliverable_uuid,
      items: [], total: 0, page: 1, page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-delivered/versions/version-delivered/facts', () => HttpResponse.json({
      request_id: 'req-delivered-facts', deliverable_uuid: deliveredDetail.deliverable_uuid,
      version_uuid: 'version-delivered', content_hash: 'd'.repeat(64), items: [], total: 0,
    })),
    http.get('/api/ai/deliverables/deliverable-delivered/reviews', () => HttpResponse.json({
      request_id: 'req-delivered-reviews', items: [], total: 0, page: 1, page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-delivered/comments', () => HttpResponse.json({
      request_id: 'req-delivered-comments', items: [], total: 0,
    })),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-delivered" />);

  expect(await screen.findByRole('heading', { name: deliveredDetail.title })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '动态' }));
  expect(await screen.findByText('来源后续已变化')).toBeInTheDocument();
  expect(screen.getByText('1 条证据来源已失效；已交付版本正文和交付记录保持不变。')).toBeInTheDocument();
  expect(screen.getByLabelText('成果正文')).toHaveValue('交付正文保持不变。');
  expect(refreshRequest).toHaveBeenCalledWith(expect.stringMatching(/^professional-evidence-refresh-/));
});

it('completes review, approval, export, delivery, and archive against one immutable version', async () => {
  const reviewRequest = vi.fn();
  const submitRequest = vi.fn();
  const approveRequest = vi.fn();
  const exportRequest = vi.fn();
  const deliveryRequest = vi.fn();
  const archiveRequest = vi.fn();
  const version = {
    version_uuid: 'version-flow',
    version_no: 3,
    parent_version_uuid: 'version-2',
    skill_version_uuid: 'skill-version-1',
    template_version_uuid: 'template-version-1',
    title_snapshot: '专业交付闭环月报',
    summary_snapshot: '同一版本完成审阅、审批与交付',
    change_summary: '专业任务生成',
    creation_reason: 'professional_run',
    content: {
      schema_version: '1',
      blocks: [{ block_id: 'body', type: 'paragraph', text: '本月安全运营工作已闭环。' }],
    },
    content_hash: 'f'.repeat(64),
    created_at: '2026-07-15T02:00:00Z',
  };
  let lifecycleStatus = 'draft';
  let rowVersion = 1;
  let allowedActions = ['review', 'export'];
  const currentDetail = () => ({
    request_id: `req-detail-${rowVersion}`,
    deliverable_uuid: 'deliverable-flow',
    title: '专业交付闭环月报',
    deliverable_type: 'security_ops_monthly_report',
    scope_type: 'personal',
    formality: 'formal',
    project_uuid: null,
    owner_user_id: 'user-1',
    lifecycle_status: lifecycleStatus,
    row_version: rowVersion,
    content_summary: '同一版本完成审阅、审批与交付',
    allowed_actions: allowedActions,
    current_version: version,
    source_change_notice: null,
    created_at: '2026-07-15T02:00:00Z',
    updated_at: `2026-07-15T02:00:0${Math.min(rowVersion, 9)}Z`,
  });
  const approvalEvent = (eventType: string, before: number, after: number) => ({
    event_uuid: `event-${eventType}`,
    event_type: eventType,
    version_uuid: version.version_uuid,
    approval_flow_version_uuid: 'flow-version-1',
    content_hash: version.content_hash,
    actor_user_id: 'user-1',
    comment_uuids: [],
    row_version_before: before,
    row_version_after: after,
    created_at: `2026-07-15T02:00:0${Math.min(after, 9)}Z`,
  });

  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:professional-export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  server.use(
    http.get('/api/ai/deliverables', () => HttpResponse.json({
      request_id: 'req-flow-list', items: [currentDetail()], total: 1, page: 1, page_size: 50,
    })),
    http.post('/api/ai/deliverables/deliverable-flow/evidence/refresh', () => HttpResponse.json({
      request_id: 'req-flow-refresh',
      deliverable_uuid: 'deliverable-flow',
      lifecycle_status: lifecycleStatus,
      row_version: rowVersion,
      invalidated_evidence_uuids: [],
      source_change_notice: null,
    })),
    http.get('/api/ai/deliverables/deliverable-flow', () => HttpResponse.json(currentDetail())),
    http.get('/api/ai/deliverables/deliverable-flow/versions', () => HttpResponse.json({
      request_id: 'req-flow-versions', deliverable_uuid: 'deliverable-flow',
      items: [{
        version_uuid: version.version_uuid,
        version_no: version.version_no,
        change_summary: version.change_summary,
        creation_reason: version.creation_reason,
        content_hash: version.content_hash,
        created_at: version.created_at,
        is_current: true,
      }],
      total: 1,
      page: 1,
      page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-flow/versions/version-flow/facts', () => HttpResponse.json({
      request_id: 'req-flow-facts', deliverable_uuid: 'deliverable-flow',
      version_uuid: version.version_uuid, content_hash: version.content_hash, items: [], total: 0,
    })),
    http.get('/api/ai/deliverables/deliverable-flow/reviews', () => HttpResponse.json({
      request_id: 'req-flow-reviews', items: [], total: 0, page: 1, page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-flow/comments', () => HttpResponse.json({
      request_id: 'req-flow-comments', items: [], total: 0,
    })),
    http.get('/api/ai/approval-flows', () => HttpResponse.json({
      request_id: 'req-flow-approval-flows',
      items: [{
        flow_uuid: 'flow-1',
        flow_key: 'personal-professional-delivery',
        name: '个人专业成果审批',
        scope_policy: 'personal',
        deliverable_types: ['*'],
        status: 'published',
        current_version: {
          version_uuid: 'flow-version-1',
          version: 1,
          content_hash: 'a'.repeat(64),
          steps: [{ step_key: 'owner-review', name: '本人确认', roles: ['owner'], required_approvals: 1 }],
          min_approvals: 1,
          allow_author_approve: true,
          reminder_config: {},
          return_target: 'author',
          status: 'published',
          published_at: '2026-07-15T00:00:00Z',
        },
      }],
      total: 1,
    })),
    http.post('/api/ai/deliverables/deliverable-flow/reviews', async ({ request }) => {
      reviewRequest(await request.json());
      lifecycleStatus = 'pending_approval';
      rowVersion = 2;
      allowedActions = ['export', 'submit'];
      return HttpResponse.json({
        request_id: 'req-flow-review',
        deliverable_uuid: 'deliverable-flow',
        lifecycle_status: lifecycleStatus,
        row_version: rowVersion,
        review: {
          review_uuid: 'review-flow',
          version_uuid: version.version_uuid,
          version_no: version.version_no,
          content_hash: version.content_hash,
          status: 'passed',
          gates_passed: true,
          total_score: 100,
          rule_version_uuids: ['review-rules-v1'],
          category_results: [{
            category: '事实与证据', status: 'passed', rule_count: 1,
            issue_count: 0, blocking_issue_count: 0, duration_ms: 18,
          }],
          issues: [],
          initiated_by: 'user-1',
          completed_at: '2026-07-15T02:00:02Z',
          created_at: '2026-07-15T02:00:02Z',
        },
      }, { status: 201 });
    }),
    http.post('/api/ai/deliverables/deliverable-flow/submit', async ({ request }) => {
      submitRequest(await request.json());
      lifecycleStatus = 'pending_approval';
      rowVersion = 3;
      allowedActions = ['export', 'approve', 'request_changes'];
      return HttpResponse.json({
        request_id: 'req-flow-submit', deliverable_uuid: 'deliverable-flow',
        lifecycle_status: lifecycleStatus, row_version: rowVersion,
        event: approvalEvent('submitted', 2, 3),
      });
    }),
    http.post('/api/ai/deliverables/deliverable-flow/approve', async ({ request }) => {
      approveRequest(await request.json());
      lifecycleStatus = 'approved';
      rowVersion = 4;
      allowedActions = ['create_revision', 'export', 'deliver'];
      return HttpResponse.json({
        request_id: 'req-flow-approve', deliverable_uuid: 'deliverable-flow',
        lifecycle_status: lifecycleStatus, row_version: rowVersion,
        event: approvalEvent('approved', 3, 4),
      });
    }),
    http.post('/api/ai/deliverables/deliverable-flow/versions/version-flow/exports', async ({ request }) => {
      exportRequest(await request.json());
      return HttpResponse.json({
        request_id: 'req-flow-export',
        deliverable_uuid: 'deliverable-flow',
        export_uuid: 'export-flow',
        version_uuid: version.version_uuid,
        version_no: version.version_no,
        content_hash: version.content_hash,
        export_format: 'docx',
        status: 'completed',
        watermarked: false,
        file_name: '专业交付闭环月报-V3.docx',
        file_hash: 'b'.repeat(64),
        file_size: 1024,
        renderer_version: 'professional-docx-v1',
        download_url: '/api/ai/exports/export-flow/download',
        created_by: 'user-1',
        created_at: '2026-07-15T02:00:04Z',
      }, { status: 201 });
    }),
    http.get('/api/ai/exports/export-flow/download', () => new HttpResponse('docx-content', {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="professional-flow.docx"',
      },
    })),
    http.post('/api/ai/deliverables/deliverable-flow/deliver', async ({ request }) => {
      deliveryRequest(await request.json());
      lifecycleStatus = 'delivered';
      rowVersion = 5;
      allowedActions = ['create_revision', 'export', 'archive'];
      return HttpResponse.json({
        request_id: 'req-flow-delivery',
        deliverable_uuid: 'deliverable-flow',
        lifecycle_status: lifecycleStatus,
        row_version: rowVersion,
        delivery: {
          delivery_uuid: 'delivery-flow',
          version_uuid: version.version_uuid,
          export_uuid: 'export-flow',
          content_hash: version.content_hash,
          delivered_by: 'user-1',
          recipient_description: '甲方项目负责人',
          note: '正式交付',
          delivered_at: '2026-07-15T02:00:05Z',
        },
      }, { status: 201 });
    }),
    http.post('/api/ai/deliverables/deliverable-flow/archive', async ({ request }) => {
      archiveRequest(await request.json());
      lifecycleStatus = 'archived';
      rowVersion = 6;
      allowedActions = ['create_revision', 'export'];
      return HttpResponse.json({
        request_id: 'req-flow-archive', deliverable_uuid: 'deliverable-flow',
        lifecycle_status: lifecycleStatus, row_version: rowVersion,
        event: approvalEvent('archived', 5, 6),
      });
    }),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-flow" />);

  await userEvent.click(await screen.findByRole('button', { name: '运行质量审阅' }));
  expect(await screen.findByText('质量审阅通过')).toBeInTheDocument();
  const submitButton = await screen.findByRole('button', { name: '提交审批' });
  await waitFor(() => expect(submitButton).toBeEnabled());
  await userEvent.click(submitButton);
  expect(await screen.findByText('已提交审批')).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('button', { name: '批准当前版本' }));
  expect(await screen.findByText('当前版本已批准')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '导出 Word' }));
  expect(await screen.findByText('已导出 专业交付闭环月报-V3.docx')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: '动态' }));
  await userEvent.type(await screen.findByLabelText('交付接收方'), '甲方项目负责人');
  await userEvent.type(screen.getByLabelText('交付说明'), '正式交付');
  await userEvent.click(screen.getByRole('button', { name: '确认交付' }));
  expect(await screen.findByText('成果已交付并锁定交付版本')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '归档交付成果' }));
  expect(await screen.findByText('成果已归档')).toBeInTheDocument();

  expect(reviewRequest).toHaveBeenCalledWith({
    row_version: 1, version_uuid: version.version_uuid, content_hash: version.content_hash,
  });
  expect(submitRequest).toHaveBeenCalledWith({
    row_version: 2,
    version_uuid: version.version_uuid,
    content_hash: version.content_hash,
    approval_flow_version_uuid: 'flow-version-1',
  });
  expect(approveRequest).toHaveBeenCalledWith({
    row_version: 3, version_uuid: version.version_uuid, content_hash: version.content_hash,
  });
  expect(exportRequest).toHaveBeenCalledWith({
    row_version: 4, content_hash: version.content_hash, export_format: 'docx',
  });
  expect(deliveryRequest).toHaveBeenCalledWith({
    row_version: 4,
    version_uuid: version.version_uuid,
    content_hash: version.content_hash,
    export_uuid: 'export-flow',
    recipient_description: '甲方项目负责人',
    note: '正式交付',
  });
  expect(archiveRequest).toHaveBeenCalledWith({
    row_version: 5,
    version_uuid: version.version_uuid,
    content_hash: version.content_hash,
    delivery_uuid: 'delivery-flow',
  });
});

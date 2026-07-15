import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { ProfessionalDeliverablesPage } from '../src/pages/ProfessionalDeliverablesPage';
import { server } from './setup';

const hashV1 = '1'.repeat(64);
const hashV2 = '2'.repeat(64);

const baseVersion = {
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
      { block_id: 'overview-body', type: 'paragraph', text: '本月闭环 12 起高风险事件。' },
    ],
  },
  content_hash: hashV2,
  created_at: '2026-07-14T08:00:00Z',
};

function installWorkbenchHandlers(input: {
  lifecycleStatus?: string;
  allowedActions: string[];
  facts?: unknown[];
  reviews?: unknown[];
  comments?: unknown[];
}) {
  const detail = {
    request_id: 'req-detail',
    deliverable_uuid: 'deliverable-1',
    title: '2026 年 6 月安全运营月报',
    deliverable_type: 'security_ops_monthly_report',
    scope_type: 'project',
    formality: 'formal',
    project_uuid: 'project-a',
    owner_user_id: 'author-1',
    lifecycle_status: input.lifecycleStatus ?? 'draft',
    row_version: 5,
    content_summary: '六月安全运营情况',
    allowed_actions: input.allowedActions,
    current_version: baseVersion,
    created_at: '2026-07-14T08:00:00Z',
    updated_at: '2026-07-15T08:00:00Z',
  };

  server.use(
    http.get('/api/ai/deliverables', () => HttpResponse.json({
      request_id: 'req-list',
      items: [detail],
      total: 1,
      page: 1,
      page_size: 50,
    })),
    http.post('/api/ai/deliverables/deliverable-1/evidence/refresh', () => HttpResponse.json({
      request_id: 'req-refresh',
      deliverable_uuid: 'deliverable-1',
      lifecycle_status: detail.lifecycle_status,
      row_version: detail.row_version,
      invalidated_evidence_uuids: [],
      source_change_notice: null,
    })),
    http.get('/api/ai/deliverables/deliverable-1', () => HttpResponse.json(detail)),
    http.get('/api/ai/deliverables/deliverable-1/versions', () => HttpResponse.json({
      request_id: 'req-versions',
      deliverable_uuid: 'deliverable-1',
      items: [
        {
          version_uuid: 'version-2', version_no: 2, parent_version_uuid: 'version-1',
          change_summary: 'AI 生成专业初稿', creation_reason: 'professional_run',
          content_hash: hashV2, created_at: '2026-07-14T08:00:00Z', is_current: true,
        },
        {
          version_uuid: 'version-1', version_no: 1, parent_version_uuid: null,
          change_summary: '初始化', creation_reason: 'created',
          content_hash: hashV1, created_at: '2026-07-13T08:00:00Z', is_current: false,
        },
      ],
      total: 2,
      page: 1,
      page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-1/versions/version-2/facts', () => HttpResponse.json({
      request_id: 'req-facts',
      deliverable_uuid: 'deliverable-1',
      version_uuid: 'version-2',
      content_hash: hashV2,
      items: input.facts ?? [],
      total: input.facts?.length ?? 0,
    })),
    http.get('/api/ai/deliverables/deliverable-1/reviews', () => HttpResponse.json({
      request_id: 'req-reviews', items: input.reviews ?? [], total: input.reviews?.length ?? 0,
      page: 1, page_size: 20,
    })),
    http.get('/api/ai/deliverables/deliverable-1/comments', () => HttpResponse.json({
      request_id: 'req-comments', deliverable_uuid: 'deliverable-1',
      items: input.comments ?? [], total: input.comments?.length ?? 0,
    })),
  );

  return detail;
}

it('confirms facts, previews exact source locations, localizes review issues, and compares versions', async () => {
  const updateFact = vi.fn();
  installWorkbenchHandlers({
    allowedActions: [
      'edit', 'create_version', 'manage_facts', 'review', 'resolve_review_issue',
      'comment', 'reply_comment', 'export',
    ],
    facts: [{
      fact_uuid: 'fact-1', deliverable_uuid: 'deliverable-1', version_uuid: 'version-2',
      content_hash: hashV2, block_id: 'overview-body', char_start: 3, char_end: 16,
      claim_type: 'fact', claim_text: '本月闭环 12 起高风险事件', claim_hash: 'f'.repeat(64),
      critical: true, status: 'pending_confirmation', source_required: true,
      human_confirmation_required: true, rationale: '', confirmed_by: '', confirmed_at: null,
      row_version: 1, created_at: '2026-07-14T08:00:00Z', updated_at: '2026-07-14T08:00:00Z',
    }],
    reviews: [{
      review_uuid: 'review-1', version_uuid: 'version-2', version_no: 2, content_hash: hashV2,
      status: 'failed', gates_passed: false, total_score: 78, rule_version_uuids: ['rule-v1'],
      category_results: [{
        category: 'evidence_traceability', status: 'failed', rule_count: 3, issue_count: 1,
        blocking_issue_count: 1, duration_ms: 18,
      }],
      issues: [{
        issue_uuid: 'issue-1', review_uuid: 'review-1', rule_version_uuid: 'rule-v1',
        category: 'evidence_traceability', severity: 'blocker', blocking: true,
        block_id: 'overview-body', char_start: 3, char_end: 16,
        message: '关键数字缺少可追溯来源', evidence_ids: [], suggested_fix: '关联原始安全日志',
        status: 'open', handled_by: '', handling_reason: '', handled_at: null,
        created_at: '2026-07-14T09:00:00Z',
      }],
      initiated_by: 'author-1', completed_at: '2026-07-14T09:00:01Z',
      created_at: '2026-07-14T09:00:00Z',
    }],
  });
  server.use(
    http.patch('/api/ai/facts/fact-1', async ({ request }) => {
      updateFact(await request.json());
      return HttpResponse.json({
        request_id: 'req-fact',
        fact: {
          fact_uuid: 'fact-1', deliverable_uuid: 'deliverable-1', version_uuid: 'version-2',
          content_hash: hashV2, block_id: 'overview-body', char_start: 3, char_end: 16,
          claim_type: 'fact', claim_text: '本月闭环 12 起高风险事件', claim_hash: 'f'.repeat(64),
          critical: true, status: 'confirmed', source_required: true,
          human_confirmation_required: true, rationale: '人工核验确认', confirmed_by: 'author-1',
          confirmed_at: '2026-07-15T09:00:00Z', row_version: 2,
          created_at: '2026-07-14T08:00:00Z', updated_at: '2026-07-15T09:00:00Z',
        },
      });
    }),
    http.get('/api/ai/evidence/search', ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('deliverable_uuid')).toBe('deliverable-1');
      expect(url.searchParams.get('version_uuid')).toBe('version-2');
      expect(url.searchParams.get('q')).toContain('12 起高风险事件');
      return HttpResponse.json({
        request_id: 'req-evidence', deliverable_uuid: 'deliverable-1', version_uuid: 'version-2',
        items: [{
          source_type: 'knowledge_chunk', source_uuid: 'chunk-12', source_version: 'file-v3',
          source_content_hash: 'e'.repeat(64), quote: '事件总数 12，均已闭环。',
          location: {
            file_name: 'security-log.xlsx', page_number: null, sheet_name: 'Events',
            cell_range: 'A12:D12', section_title: '', paragraph_index: null, chunk_id: 'chunk-12',
          },
        }], total: 1,
      });
    }),
    http.get('/api/ai/deliverables/deliverable-1/diff', () => HttpResponse.json({
      request_id: 'req-diff', deliverable_uuid: 'deliverable-1',
      from_version_uuid: 'version-1', from_version_no: 1,
      to_version_uuid: 'version-2', to_version_no: 2,
      summary: { added_blocks: 0, removed_blocks: 0, modified_blocks: 1, unchanged_blocks: 1 },
      changes: [{
        block_id: 'overview-body', block_type: 'paragraph', change_type: 'modified',
        before: { block_id: 'overview-body', type: 'paragraph', text: '本月闭环 10 起事件。' },
        after: { block_id: 'overview-body', type: 'paragraph', text: '本月闭环 12 起高风险事件。' },
        field_changes: [{ path: 'text', change_type: 'modified', before: '10 起', after: '12 起' }],
      }],
    })),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-1" />);

  expect(await screen.findByText('待人工确认')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认事实' }));
  await waitFor(() => expect(updateFact).toHaveBeenCalledWith({
    row_version: 1, status: 'confirmed', rationale: '人工核验确认',
  }));
  expect(await screen.findByText('已确认')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '查找证据' }));
  expect(await screen.findByText('security-log.xlsx · 工作表 Events · A12:D12')).toBeInTheDocument();
  expect(screen.getByText('事件总数 12，均已闭环。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: '质量审阅' }));
  expect(await screen.findByText('关键数字缺少可追溯来源')).toBeInTheDocument();
  expect(screen.getByText('区块 overview-body · 字符 3–16')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '定位正文' }));
  expect(screen.getByLabelText('成果正文')).toHaveFocus();

  await userEvent.click(screen.getByRole('tab', { name: '版本' }));
  await userEvent.click(screen.getByRole('button', { name: '比较 V1 与当前版本' }));
  expect(await screen.findByText('V1 → V2')).toBeInTheDocument();
  expect(screen.getByText('修改 1 个区块')).toBeInTheDocument();
  expect(screen.getByText('text：10 起 → 12 起')).toBeInTheDocument();
});

it('renders only authoritative approval actions and requires a reason plus comment to request changes', async () => {
  const requestChanges = vi.fn();
  installWorkbenchHandlers({
    lifecycleStatus: 'pending_approval',
    allowedActions: ['comment', 'reply_comment', 'export', 'approve', 'request_changes'],
    comments: [{
      comment_uuid: 'comment-1', version_uuid: 'version-2', block_id: 'overview-body',
      char_start: 3, char_end: 16, content: '请补充这项数字的来源。', status: 'open',
      author_user_id: 'reviewer-1', resolved_by: '', resolved_at: null, resolution_reason: '',
      allowed_actions: ['resolve_comment'],
      replies: [], created_at: '2026-07-15T08:30:00Z',
    }],
  });
  server.use(
    http.post('/api/ai/deliverables/deliverable-1/request-changes', async ({ request }) => {
      requestChanges(await request.json());
      return HttpResponse.json({
        request_id: 'req-changes', deliverable_uuid: 'deliverable-1',
        lifecycle_status: 'changes_requested', row_version: 6,
        event: {
          event_uuid: 'event-1', event_type: 'request_changes', version_uuid: 'version-2',
          approval_flow_version_uuid: 'flow-version-1', content_hash: hashV2,
          actor_user_id: 'reviewer-1', comment_uuids: ['comment-1'],
          row_version_before: 5, row_version_after: 6, created_at: '2026-07-15T09:00:00Z',
        },
      });
    }),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-1" />);

  expect(await screen.findByRole('button', { name: '批准当前版本' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存为新版本' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交审批' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: '评论' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /关联评论：请补充这项数字的来源/ }));
  await userEvent.type(screen.getByLabelText('退回原因'), '关键数字尚无可核验证据');
  await userEvent.click(screen.getByRole('button', { name: '退回修改' }));

  await waitFor(() => expect(requestChanges).toHaveBeenCalledWith({
    row_version: 5,
    version_uuid: 'version-2',
    content_hash: hashV2,
    reason: '关键数字尚无可核验证据',
    comment_uuids: ['comment-1'],
  }));
  expect(await screen.findByText('已退回修改')).toBeInTheDocument();
});

it('submits the exact current version through the published flow for its project scope', async () => {
  const submit = vi.fn();
  installWorkbenchHandlers({
    allowedActions: ['export', 'submit'],
  });
  server.use(
    http.get('/api/ai/approval-flows', () => HttpResponse.json({
      request_id: 'req-flows',
      items: [{
        flow_uuid: 'flow-1', flow_key: 'project_standard_review', name: '项目成果复核',
        scope_policy: 'project', deliverable_types: ['*'], status: 'published',
        current_version: {
          version_uuid: 'flow-version-1', version: 1, content_hash: 'f'.repeat(64),
          steps: [], min_approvals: 1, allow_author_approve: false,
          reminder_config: {}, return_target: 'author', status: 'published', published_at: null,
        },
      }],
      total: 1,
    })),
    http.post('/api/ai/deliverables/deliverable-1/submit', async ({ request }) => {
      submit(await request.json());
      return HttpResponse.json({
        request_id: 'req-submit', deliverable_uuid: 'deliverable-1',
        lifecycle_status: 'pending_approval', row_version: 6,
        event: {
          event_uuid: 'event-submit', event_type: 'submit', version_uuid: 'version-2',
          approval_flow_version_uuid: 'flow-version-1', content_hash: hashV2,
          actor_user_id: 'author-1', comment_uuids: [], row_version_before: 5,
          row_version_after: 6, created_at: '2026-07-15T09:00:00Z',
        },
      });
    }),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-1" />);

  expect(await screen.findByText('审批流：项目成果复核 V1')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '提交审批' }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({
    row_version: 5,
    version_uuid: 'version-2',
    content_hash: hashV2,
    approval_flow_version_uuid: 'flow-version-1',
  }));
  expect(await screen.findByText('已提交审批')).toBeInTheDocument();
});

it('updates mutable metadata without changing version content and submits only an exact deidentified experience candidate', async () => {
  const updateMetadata = vi.fn();
  const submitCandidate = vi.fn();
  const detail = installWorkbenchHandlers({
    lifecycleStatus: 'delivered',
    allowedActions: ['update_metadata', 'submit_experience', 'export', 'archive'],
  });
  server.use(
    http.patch('/api/ai/deliverables/deliverable-1', async ({ request }) => {
      updateMetadata(await request.json());
      return HttpResponse.json({
        ...detail,
        title: '2026 年 6 月安全运营正式月报',
        row_version: 6,
        updated_at: '2026-07-15T10:00:00Z',
      });
    }),
    http.post('/api/ai/deliverables/deliverable-1/experience-candidates', async ({ request }) => {
      submitCandidate(await request.json());
      return HttpResponse.json({
        request_id: 'req-experience',
        deliverable_uuid: 'deliverable-1',
        candidate: {
          candidate_uuid: 'candidate-1', candidate_type: 'rule', status: 'pending_review',
          source_scope_type: 'project', source_project_uuid: 'project-a',
          version_uuid: 'version-2', content_hash: hashV2,
          deidentified_summary: '每月按风险等级复核闭环情况，并由责任人确认异常项。',
          submitted_by: 'author-1', created_at: '2026-07-15T10:05:00Z',
        },
      });
    }),
  );

  render(<ProfessionalDeliverablesPage initialDeliverableId="deliverable-1" />);

  await userEvent.click(await screen.findByRole('tab', { name: '动态' }));
  const titleInput = screen.getByLabelText('成果标题');
  await userEvent.clear(titleInput);
  await userEvent.type(titleInput, '2026 年 6 月安全运营正式月报');
  await userEvent.click(screen.getByRole('button', { name: '保存标题' }));
  await waitFor(() => expect(updateMetadata).toHaveBeenCalledWith({
    row_version: 5,
    title: '2026 年 6 月安全运营正式月报',
  }));
  expect(await screen.findByText('成果标题已更新，历史版本标题快照保持不变')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('经验类型'), 'rule');
  await userEvent.type(
    screen.getByLabelText('脱敏经验摘要'),
    '每月按风险等级复核闭环情况，并由责任人确认异常项。',
  );
  await userEvent.click(screen.getByRole('button', { name: '提交经验候选' }));
  await waitFor(() => expect(submitCandidate).toHaveBeenCalledWith({
    row_version: 6,
    version_uuid: 'version-2',
    content_hash: hashV2,
    candidate_type: 'rule',
    deidentified_summary: '每月按风险等级复核闭环情况，并由责任人确认异常项。',
  }));
  expect(await screen.findByText('脱敏经验候选已提交，等待人工审核')).toBeInTheDocument();
  expect(screen.getByText('候选 candidate-1 · 待人工审核')).toBeInTheDocument();
  expect(screen.getByText(/不会自动跨项目复用正文、客户数据或证据/)).toBeInTheDocument();
});

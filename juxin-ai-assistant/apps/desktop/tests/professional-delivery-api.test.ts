import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import {
  approveProfessionalDeliverable,
  cancelProfessionalRun,
  createProfessionalDeliverableComment,
  extractProfessionalDeliverableFacts,
  getProfessionalRunDetail,
  getProfessionalDeliverableDiff,
  replyProfessionalDeliverableComment,
  requestProfessionalDeliverableChanges,
  resumeProfessionalRun,
  resolveProfessionalDeliverableComment,
  startProfessionalDeliverableReview,
  streamProfessionalRunEvents,
  submitProfessionalDeliverable,
  supplyProfessionalRunInput,
  updateProfessionalDeliverableFact,
} from '../src/api/deliverables';
import { listProfessionalApprovalFlows } from '../src/api/approvalFlows';
import { server } from './setup';

const contentHash = 'a'.repeat(64);

it('loads a recoverable professional run and uses idempotent control endpoints', async () => {
  const requests = vi.fn();
  server.use(
    http.get('/api/ai/runs/run-1', () => HttpResponse.json({
      run: {
        run_id: 'run-1', title: '专业任务', run_type: 'professional_delivery',
        status: 'waiting_confirmation', stage: 'executing', progress: 70,
        artifact: null, citations: [], created_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-15T00:00:01Z',
      },
      steps: [], events: [], result: {},
      professional: {
        run_uuid: 'run-1', deliverable_uuid: 'deliverable-1', status: 'waiting_for_input', phase: 'completeness',
        source_version_uuid: 'version-1', skill_version_uuid: 'skill-version-1', template_version_uuid: 'template-version-1',
        context_hash: contentHash, missing_fields: ['period'], pending_model_request: null,
        created_version_uuid: null, allowed_actions: ['supply_input', 'cancel'], stages: [],
      },
    })),
    http.post('/api/ai/runs/run-1/input', async ({ request }) => {
      requests('input', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ run_uuid: 'run-1', status: 'waiting_for_model' }, { status: 202 });
    }),
    http.post('/api/ai/runs/run-1/resume', ({ request }) => {
      requests('resume', null, request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ run_uuid: 'run-1', status: 'waiting_for_model' }, { status: 202 });
    }),
    http.post('/api/ai/runs/run-1/cancel', () => HttpResponse.json({
      run_id: 'run-1', title: '专业任务', run_type: 'professional_delivery', status: 'cancelled',
      stage: 'cancelled', progress: 70, artifact: null, citations: [],
      created_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-15T00:00:02Z',
    })),
  );

  const detail = await getProfessionalRunDetail('run-1');
  await supplyProfessionalRunInput('run-1', { period: '2026-07' }, 'idem-input');
  await resumeProfessionalRun('run-1', 'idem-resume');
  const cancelled = await cancelProfessionalRun('run-1');

  expect(detail.professional?.missing_fields).toEqual(['period']);
  expect(requests.mock.calls).toEqual([
    ['input', { inputs: { period: '2026-07' } }, 'idem-input'],
    ['resume', null, 'idem-resume'],
  ]);
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.run_id).toBe('run-1');
});

it('reconnects the run event stream from the last received sequence', async () => {
  const originalFetch = globalThis.fetch;
  const event = (sequence: number, eventType: string) => ({
    event_id: `event-${sequence}`,
    run_id: 'run-1',
    sequence,
    event_type: eventType,
    stage: eventType === 'completed' ? 'completed' : 'executing',
    label: `事件 ${sequence}`,
    progress: eventType === 'completed' ? 100 : 70,
    content: '',
    source: null,
    artifact_id: '',
    quality: null,
  });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(event(3, 'stage'))}\n\n`))
    .mockResolvedValueOnce(new Response(`data: ${JSON.stringify(event(4, 'completed'))}\n\n`));
  vi.stubGlobal('fetch', fetchMock);
  const received: number[] = [];

  try {
    const cursor = await streamProfessionalRunEvents('run-1', {
      after: 2,
      maxReconnects: 1,
      reconnectDelayMs: 0,
      onEvent: (nextEvent) => {
        received.push(nextEvent.sequence);
      },
    });

    expect(cursor).toBe(4);
    expect(received).toEqual([3, 4]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/ai/runs/run-1/events?after=2',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/ai/runs/run-1/events?after=3',
      expect.objectContaining({ credentials: 'include' }),
    );
  } finally {
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('queries the published approval flow for the exact scope and deliverable type', async () => {
  const requests = vi.fn();
  server.use(
    http.get('/api/ai/approval-flows', ({ request }) => {
      const url = new URL(request.url);
      requests(Object.fromEntries(url.searchParams.entries()));
      return HttpResponse.json({
        request_id: 'req-flows',
        items: [{
          flow_uuid: 'flow-1',
          flow_key: 'project_standard_review',
          name: '项目成果复核',
          scope_policy: 'project',
          deliverable_types: ['*'],
          status: 'published',
          current_version: {
            version_uuid: 'flow-version-1',
            version: 1,
            content_hash: contentHash,
            steps: [{
              step_key: 'review',
              name: '项目复核',
              roles: ['reviewer', 'project_lead', 'project_admin'],
              required_approvals: 1,
            }],
            min_approvals: 1,
            allow_author_approve: false,
            reminder_config: { enabled: true, after_hours: 24 },
            return_target: 'author',
            status: 'published',
            published_at: '2026-07-15T00:00:00Z',
          },
        }],
        total: 1,
      });
    }),
  );

  const result = await listProfessionalApprovalFlows({
    scopeType: 'project',
    deliverableType: 'security_ops_monthly_report',
    projectUuid: 'project-1',
  });

  expect(requests).toHaveBeenCalledWith({
    scope_type: 'project',
    deliverable_type: 'security_ops_monthly_report',
    project_uuid: 'project-1',
  });
  expect(result.items[0]?.current_version.allow_author_approve).toBe(false);
  expect(result.items[0]?.current_version.steps[0]?.roles).toEqual([
    'reviewer', 'project_lead', 'project_admin',
  ]);
});

it('targets an immutable version for diff, fact extraction, fact updates, and review', async () => {
  const requests = vi.fn();
  server.use(
    http.get('/api/ai/deliverables/deliverable-1/diff', ({ request }) => {
      const url = new URL(request.url);
      requests('diff', {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      });
      return HttpResponse.json({
        request_id: 'req-diff',
        deliverable_uuid: 'deliverable-1',
        from_version_uuid: 'version-1',
        from_version_no: 1,
        to_version_uuid: 'version-2',
        to_version_no: 2,
        summary: { added_blocks: 0, removed_blocks: 0, modified_blocks: 1, unchanged_blocks: 2 },
        changes: [],
      });
    }),
    http.post('/api/ai/deliverables/deliverable-1/versions/version-2/facts/extract', async ({ request }) => {
      requests('extract', {
        body: await request.json(),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      });
      return HttpResponse.json({
        request_id: 'req-extract', deliverable_uuid: 'deliverable-1', version_uuid: 'version-2',
        content_hash: contentHash, items: [], total: 0,
      }, { status: 201 });
    }),
    http.patch('/api/ai/facts/fact-1', async ({ request }) => {
      requests('fact', {
        body: await request.json(),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      });
      return HttpResponse.json({ request_id: 'req-fact', fact: { fact_uuid: 'fact-1' } });
    }),
    http.post('/api/ai/deliverables/deliverable-1/reviews', async ({ request }) => {
      requests('review', {
        body: await request.json(),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      });
      return HttpResponse.json({
        request_id: 'req-review', deliverable_uuid: 'deliverable-1', lifecycle_status: 'draft', row_version: 3,
        review: { review_uuid: 'review-1', status: 'passed', issues: [] },
      }, { status: 201 });
    }),
  );

  await getProfessionalDeliverableDiff('deliverable-1', 'version-1', 'version-2');
  await extractProfessionalDeliverableFacts(
    'deliverable-1', 'version-2', { content_hash: contentHash }, 'idem-extract',
  );
  await updateProfessionalDeliverableFact(
    'fact-1', { row_version: 2, status: 'confirmed', rationale: '已与原始记录核验' }, 'idem-fact',
  );
  await startProfessionalDeliverableReview(
    'deliverable-1', { row_version: 2, version_uuid: 'version-2', content_hash: contentHash }, 'idem-review',
  );

  expect(requests.mock.calls).toEqual([
    ['diff', { from: 'version-1', to: 'version-2' }],
    ['extract', { body: { content_hash: contentHash }, idempotencyKey: 'idem-extract' }],
    ['fact', {
      body: { row_version: 2, status: 'confirmed', rationale: '已与原始记录核验' },
      idempotencyKey: 'idem-fact',
    }],
    ['review', {
      body: { row_version: 2, version_uuid: 'version-2', content_hash: contentHash },
      idempotencyKey: 'idem-review',
    }],
  ]);
});

it('uses dedicated comment and approval endpoints with idempotent writes', async () => {
  const requests = vi.fn();
  server.use(
    http.post('/api/ai/deliverables/deliverable-1/comments', async ({ request }) => {
      requests('comment', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ request_id: 'req-comment', deliverable_uuid: 'deliverable-1', comment: {} }, { status: 201 });
    }),
    http.post('/api/ai/comments/comment-1/replies', async ({ request }) => {
      requests('reply', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ request_id: 'req-reply', deliverable_uuid: 'deliverable-1', comment: {} }, { status: 201 });
    }),
    http.post('/api/ai/comments/comment-1/resolve', async ({ request }) => {
      requests('resolve', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ request_id: 'req-resolve', deliverable_uuid: 'deliverable-1', comment: {} });
    }),
    http.post('/api/ai/deliverables/deliverable-1/submit', async ({ request }) => {
      requests('submit', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ request_id: 'req-submit', deliverable_uuid: 'deliverable-1', lifecycle_status: 'in_review', row_version: 3, event: {} });
    }),
    http.post('/api/ai/deliverables/deliverable-1/approve', async ({ request }) => {
      requests('approve', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ request_id: 'req-approve', deliverable_uuid: 'deliverable-1', lifecycle_status: 'approved', row_version: 4, event: {} });
    }),
    http.post('/api/ai/deliverables/deliverable-1/request-changes', async ({ request }) => {
      requests('request-changes', await request.json(), request.headers.get('Idempotency-Key'));
      return HttpResponse.json({ request_id: 'req-changes', deliverable_uuid: 'deliverable-1', lifecycle_status: 'changes_requested', row_version: 4, event: {} });
    }),
  );

  await createProfessionalDeliverableComment('deliverable-1', {
    version_uuid: 'version-2', block_id: 'summary', char_start: 4, char_end: 18, content: '请补充数据来源。',
  }, 'idem-comment');
  await replyProfessionalDeliverableComment('comment-1', { content: '已补充。' }, 'idem-reply');
  await resolveProfessionalDeliverableComment('comment-1', { reason: '来源已补充并复核' }, 'idem-resolve');
  await submitProfessionalDeliverable('deliverable-1', {
    row_version: 2, version_uuid: 'version-2', content_hash: contentHash,
    approval_flow_version_uuid: 'flow-version-1',
  }, 'idem-submit');
  await approveProfessionalDeliverable('deliverable-1', {
    row_version: 3, version_uuid: 'version-2', content_hash: contentHash,
  }, 'idem-approve');
  await requestProfessionalDeliverableChanges('deliverable-1', {
    row_version: 3, version_uuid: 'version-2', content_hash: contentHash,
    reason: '关键结论缺少证据', comment_uuids: ['comment-1'],
  }, 'idem-changes');

  expect(requests).toHaveBeenCalledTimes(6);
  expect(requests).toHaveBeenCalledWith('submit', expect.objectContaining({
    approval_flow_version_uuid: 'flow-version-1',
  }), 'idem-submit');
  expect(requests).toHaveBeenCalledWith('request-changes', expect.objectContaining({
    reason: '关键结论缺少证据', comment_uuids: ['comment-1'],
  }), 'idem-changes');
});

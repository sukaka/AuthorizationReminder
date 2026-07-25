import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { WorkflowsPage } from '../src/pages/WorkflowsPage';
import { server } from './setup';

const workflows = [
  {
    id: 'parallel_dual',
    name: '并行：摘要+回声',
    description: '并行跑 summary 与 echo',
    step_count: 2,
    custom: false,
  },
  {
    id: 'condition_route_demo',
    name: '条件：长文走 Kimi',
    description: '按长度选 Agent',
    step_count: 2,
    custom: false,
  },
];

it('loads workflows, shows canvas nodes, and runs a workflow', async () => {
  const runBody = vi.fn();
  server.use(
    http.get('/api/ai/workflows', () => HttpResponse.json({ items: workflows, total: 2 })),
    http.get('/api/ai/workflows/parallel_dual', () =>
      HttpResponse.json({
        id: 'parallel_dual',
        name: '并行：摘要+回声',
        description: '并行跑 summary 与 echo',
        steps: [
          {
            id: 'parallel',
            type: 'parallel',
            params: {
              branches: [
                { id: 'sum', steps: [{ id: 's1', type: 'invoke', params: { agent_id: 'local.summary' } }] },
                { id: 'ech', steps: [{ id: 'e1', type: 'invoke', params: { agent_id: 'local.echo' } }] },
              ],
            },
          },
          { id: 'merge', type: 'merge', params: { from: 'parallel' } },
        ],
      }),
    ),
    http.get('/api/ai/workflows/condition_route_demo', () =>
      HttpResponse.json({
        id: 'condition_route_demo',
        name: '条件：长文走 Kimi',
        steps: [
          {
            id: 'branch',
            type: 'condition',
            params: { if: 'input_text_len_gt', threshold: 40, then_agent: 'kimi.chat', else_agent: 'local.summary' },
          },
          { id: 'invoke', type: 'invoke', params: { agent_from: 'branch.selected_agent_id' } },
        ],
      }),
    ),
    http.post('/api/ai/workflows/parallel_dual/run', async ({ request }) => {
      runBody(await request.json());
      return HttpResponse.json({
        status: 'succeeded',
        steps: [
          { id: 'parallel', type: 'parallel', status: 'succeeded', latency_ms: 12 },
          { id: 'merge', type: 'merge', status: 'succeeded', latency_ms: 1 },
        ],
        agent_run_id: 'run-wf-1',
      });
    }),
    http.post('/api/ai/workflows/route', async () =>
      HttpResponse.json({
        selected_agent_id: 'local.summary',
        agent_run_id: 'run-route-1',
        candidates: [{ agent_id: 'local.summary', score: 0.9, cost_per_call_micros: 0, avg_latency_ms: 5 }],
      }),
    ),
  );

  const onOpenTaskCenter = vi.fn();
  render(<WorkflowsPage onOpenTaskCenter={onOpenTaskCenter} />);

  expect(await screen.findByRole('heading', { name: '工作流' })).toBeInTheDocument();
  expect(await screen.findAllByText('并行：摘要+回声')).not.toHaveLength(0);

  await userEvent.click(screen.getByRole('button', { name: /parallel_dual/ }));
  expect(await screen.findByText(/并行分支/)).toBeInTheDocument();
  expect(screen.getAllByText(/sum/).length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: '运行工作流' }));
  await waitFor(() => expect(runBody).toHaveBeenCalled());
  expect(await screen.findByText(/运行状态：成功/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '在任务中心打开' }));
  expect(onOpenTaskCenter).toHaveBeenCalledWith('run-wf-1');
});

it('opens builder for drag orchestration', async () => {
  server.use(
    http.get('/api/ai/workflows', () => HttpResponse.json({ items: workflows, total: 2 })),
    http.get('/api/ai/workflows/:id', () =>
      HttpResponse.json({ id: 'parallel_dual', name: '并行', steps: [] }),
    ),
  );

  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: '工作流' });
  await userEvent.click(screen.getByRole('button', { name: '拖拽编排' }));
  expect(await screen.findByText('拖拽步骤编排')).toBeInTheDocument();
  expect(screen.getByLabelText('编排画布预览')).toBeInTheDocument();
});

it('creates and pauses an automatic run from a plain-language schedule', async () => {
  const createBody = vi.fn();
  const disableSchedule = vi.fn();
  server.use(
    http.get('/api/ai/workflows', () => HttpResponse.json({ items: workflows, total: 2 })),
    http.get('/api/ai/workflows/schedules', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/workflows/:id', ({ params }) =>
      HttpResponse.json({
        id: String(params.id),
        name: '流程定义',
        description: '测试流程',
        steps: [],
      }),
    ),
    http.post('/api/ai/workflows/schedules', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      createBody(body);
      return HttpResponse.json({
        schedule_uuid: 'schedule-1',
        owner_user_id: 'user-1',
        workflow_id: body.workflow_id,
        name: body.name,
        cron_expression: body.cron_expression,
        timezone: body.timezone,
        enabled: true,
        next_fire_at: '2026-07-27T01:00:00Z',
        last_fire_at: null,
        misfire_policy: 'skip',
        catch_up: false,
        concurrency_policy: 'forbid',
        idempotency_prefix: body.idempotency_prefix,
        metadata: body.metadata,
      }, { status: 201 });
    }),
    http.post('/api/ai/workflows/schedules/schedule-1/disable', () => {
      disableSchedule();
      return HttpResponse.json({
        schedule_uuid: 'schedule-1',
        owner_user_id: 'user-1',
        workflow_id: 'parallel_dual',
        name: '并行：摘要+回声 · 每个工作日 09:00',
        cron_expression: '0 9 * * 1-5',
        timezone: 'Asia/Shanghai',
        enabled: false,
        next_fire_at: null,
        last_fire_at: null,
        misfire_policy: 'skip',
        catch_up: false,
        concurrency_policy: 'forbid',
        idempotency_prefix: 'ui-parallel_dual',
        metadata: {},
      });
    }),
  );

  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: '工作流' });
  await userEvent.click(screen.getByRole('button', { name: '设置自动运行' }));
  expect(await screen.findByRole('region', { name: '自动运行设置' })).toBeInTheDocument();
  expect(screen.getByText('每个工作日 09:00')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '创建自动运行' }));
  await waitFor(() => expect(createBody).toHaveBeenCalledWith(expect.objectContaining({
    workflow_id: 'parallel_dual',
    cron_expression: '0 9 * * 1-5',
    concurrency_policy: 'forbid',
    metadata: expect.objectContaining({
      input_text: '请对这段业务说明做简短摘要，便于汇报。',
    }),
  })));
  expect(await screen.findByText(/下次：/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '暂停' }));
  await waitFor(() => expect(disableSchedule).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "恢复" })).toBeInTheDocument();
});

it('keeps the workflow library searchable and filterable', async () => {
  server.use(
    http.get('/api/ai/workflows', () => HttpResponse.json({
      items: [
        ...workflows,
        { id: 'custom_flow', name: '月度经营报告', description: '自定义交付流程', step_count: 3, custom: true },
      ],
      total: 3,
    })),
    http.get('/api/ai/workflows/:id', ({ params }) => HttpResponse.json({
      id: String(params.id),
      name: '流程定义',
      description: '测试流程',
      steps: [],
    })),
  );

  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: '工作流' });

  await userEvent.click(screen.getByRole('button', { name: '自定义' }));
  expect(await screen.findByRole('button', { name: /custom_flow/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /parallel_dual/ })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '全部' }));
  await userEvent.type(screen.getByRole('textbox', { name: '搜索工作流' }), 'condition');
  expect(await screen.findByRole('button', { name: /condition_route_demo/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /parallel_dual/ })).not.toBeInTheDocument();
});

it('checks a saved draft before publishing and can copy it into the builder', async () => {
  const publish = vi.fn();
  server.use(
    http.get('/api/ai/workflows', () => HttpResponse.json({
      items: [{
        id: 'custom_flow', name: '自定义流程', description: '可发布草稿', step_count: 1, custom: true,
      }], total: 1,
    })),
    http.get('/api/ai/workflows/custom_flow', () => HttpResponse.json({
      id: 'custom_flow', name: '自定义流程', description: '可发布草稿',
      steps: [{ id: 's1', type: 'invoke', params: { agent_id: 'local.summary' } }],
    })),
    http.post('/api/ai/workflows/custom/custom_flow/validate', () => HttpResponse.json({
      valid: true, errors: [], warnings: [{ code: 'LOW_RISK', message: '本地 Agent' }],
      preview: { node_count: 1, max_depth: 1, requires_approval: false, nodes: [], edges: [] },
    })),
    http.post('/api/ai/workflows/custom/custom_flow/publish', () => {
      publish();
      return HttpResponse.json({ id: 'custom_flow', status: 'published', version: 1 });
    }),
  );

  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: '工作流' });
  await userEvent.click(screen.getByRole('button', { name: '检查当前草稿' }));
  expect(await screen.findByText('检查通过')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '流程检查结果' })).getByText(/1 个节点/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
  await waitFor(() => expect(publish).toHaveBeenCalled());
  expect(await screen.findByText(/流程已发布/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '复制为新流程' }));
  expect(await screen.findByText('拖拽步骤编排')).toBeInTheDocument();
  expect(screen.getByLabelText(/s1 参数 JSON/)).toHaveValue('{\n  "agent_id": "local.summary"\n}');
});

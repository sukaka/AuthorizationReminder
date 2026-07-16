import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { AgentHubPage } from '../src/pages/AgentHubPage';
import { server } from './setup';

const agents = [
  {
    agent_id: 'local.echo',
    name: '本地回声 Agent',
    description: '开发与联调用本地 Agent',
    version: '0.1.0',
    capabilities: ['echo', 'health'],
    endpoint: '',
    status: 'available',
  },
  {
    agent_id: 'kimi.chat',
    name: 'Kimi 长文分析',
    description: '长文档分析',
    version: '1.0.0',
    capabilities: ['long_document', 'reasoning'],
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    status: 'available',
  },
];

function mockHubApis(invokeImpl?: (body: unknown) => unknown) {
  const invoke = vi.fn(async (body: unknown) => {
    if (invokeImpl) return invokeImpl(body);
    return { agent_id: 'local.echo', output: '[echo] hi' };
  });
  server.use(
    http.get('/api/ai/agent-hub/agents', () => HttpResponse.json(agents)),
    http.get('/api/ai/agent-hub/market', () =>
      HttpResponse.json({
        items: [
          {
            agent_id: 'local.echo',
            name: '本地回声 Agent',
            status: 'installed',
            cost_per_call_micros: 0,
          },
          {
            agent_id: 'kimi.chat',
            name: 'Kimi 长文分析',
            status: 'installed',
            cost_per_call_micros: 2000,
          },
        ],
        total: 2,
      }),
    ),
    http.get('/api/ai/agent-hub/health', () =>
      HttpResponse.json({
        items: [
          { agent_id: 'local.echo', ok: true, status: 'ok', circuit_state: 'closed' },
          {
            agent_id: 'kimi.chat',
            ok: true,
            status: 'ok',
            circuit_state: 'closed',
            dry_run: true,
            detail: 'dry_run',
          },
        ],
        total: 2,
        healthy: 2,
        overall: 'ok',
      }),
    ),
    http.post('/api/ai/agent-hub/agents/:id/invoke', async ({ request, params }) => {
      const body = await request.json();
      const result = await invoke(body);
      return HttpResponse.json({ ...(result as object), agent_id: params.id });
    }),
    http.post('/api/ai/agent-hub/market/:id/status', async ({ request, params }) => {
      const body = (await request.json()) as { status: string };
      return HttpResponse.json({ agent_id: params.id, status: body.status });
    }),
  );
  return { invoke };
}

it('lists agents and invokes local echo', async () => {
  const { invoke } = mockHubApis();
  render(<AgentHubPage isAdmin={false} />);

  expect(await screen.findByRole('heading', { name: 'Agent 市场' })).toBeInTheDocument();
  expect(await screen.findAllByText('本地回声 Agent')).not.toHaveLength(0);
  expect(screen.getAllByText('Kimi 长文分析').length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: /local\.echo/ }));
  await userEvent.click(screen.getByRole('button', { name: '试调调用' }));

  await waitFor(() => expect(invoke).toHaveBeenCalled());
  expect(await screen.findByText(/调用成功/)).toBeInTheDocument();
  expect(await screen.findByText(/\[echo\]/)).toBeInTheDocument();
});

it('shows egress confirmation for external agents and admin market actions', async () => {
  mockHubApis(() => ({ agent_id: 'kimi.chat', output: '[kimi-dry-run] ok', mode: 'dry_run' }));
  render(<AgentHubPage isAdmin />);

  await screen.findByText(/kimi\.chat/);
  await userEvent.click(screen.getByRole('button', { name: /kimi\.chat/ }));

  expect(await screen.findByText(/确认出域发送/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '授权' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: '试调调用' }));
  expect(await screen.findByText(/kimi-dry-run/)).toBeInTheDocument();
});

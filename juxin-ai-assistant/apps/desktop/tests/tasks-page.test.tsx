import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { TasksPage } from '../src/pages/TasksPage';
import { server } from './setup';

it('opens a deep-linked task without exposing internal routing ids', async () => {
  const onOpenArtifact = vi.fn();
  const onOpenChat = vi.fn();
  const onOpenWorkflow = vi.fn();
  server.use(
    http.get('/api/ai/runs', () => HttpResponse.json({
      items: [{
        run_id: 'run-deep-link',
        conversation_id: 'conversation-origin',
        title: '客户汇报 PPT',
        status: 'succeeded',
        stage: 'completed',
        progress: 100,
      }],
      total: 1,
    })),
    http.get('/api/ai/runs/run-deep-link', () => HttpResponse.json({
      run: {
        run_id: 'run-deep-link',
        conversation_id: 'conversation-origin',
        title: '客户汇报 PPT',
        status: 'succeeded',
        stage: 'completed',
        progress: 100,
      },
      steps: [],
      events: [],
      result: {
        answer: 'PPT 已生成。',
        artifact_id: 'artifact-result',
        selected_agent_id: 'agent-internal-id',
        workflow: {
          workflow_id: 'workflow-internal-id',
          status: 'completed',
        },
      },
    })),
  );

  render(
    <TasksPage
      initialRunId="run-deep-link"
      onOpenArtifact={onOpenArtifact}
      onOpenChat={onOpenChat}
      onOpenWorkflow={onOpenWorkflow}
    />,
  );

  expect(await screen.findByRole('heading', { name: '客户汇报 PPT' })).toBeInTheDocument();
  expect(screen.getByText('PPT 已生成。')).toBeInTheDocument();
  expect(screen.queryByText('run-deep-link')).not.toBeInTheDocument();
  expect(screen.queryByText('agent-internal-id')).not.toBeInTheDocument();
  expect(screen.queryByText('workflow-internal-id')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '打开原会话' }));
  expect(onOpenChat).toHaveBeenCalledWith('conversation-origin');
  await userEvent.click(screen.getByRole('button', { name: '打开成果' }));
  expect(onOpenArtifact).toHaveBeenCalledWith('artifact-result');
  await userEvent.click(screen.getByRole('button', { name: '打开工作流' }));
  expect(onOpenWorkflow).toHaveBeenCalledWith('workflow-internal-id');
  expect(screen.getAllByText('客户汇报 PPT')).toHaveLength(2);
});

it('shows a safe failure reason and retries a recoverable task', async () => {
  const retryRequest = vi.fn();
  server.use(
    http.get('/api/ai/runs', () => HttpResponse.json({
      items: [{
        run_id: 'run-failed',
        title: '失败的报告任务',
        status: 'failed',
        stage: 'failed',
        progress: 65,
      }],
      total: 1,
    })),
    http.get('/api/ai/runs/run-failed', () => HttpResponse.json({
      run: {
        run_id: 'run-failed',
        title: '失败的报告任务',
        status: 'failed',
        stage: 'failed',
        progress: 65,
        next_action: '请检查失败原因后重试',
        error_code: 'MODEL_TIMEOUT',
        error_message: '生成超时，请稍后重试',
        retry_allowed: true,
        cancel_allowed: false,
      },
      steps: [],
      events: [],
      result: {},
    })),
    http.post('/api/ai/runs/run-failed/retry', () => {
      retryRequest();
      return HttpResponse.json({
        run: {
          run_id: 'run-failed',
          title: '失败的报告任务',
          status: 'retrying',
          stage: 'accepted',
          progress: 0,
        },
      });
    }),
  );

  render(<TasksPage initialRunId="run-failed" />);

  expect(await screen.findByText('下一步：请检查失败原因后重试')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('生成超时，请稍后重试（MODEL_TIMEOUT）');
  expect(screen.queryByRole('button', { name: '取消任务' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '重新运行' }));

  expect(retryRequest).toHaveBeenCalledOnce();
  expect(await screen.findByText('任务已重新进入处理队列')).toBeInTheDocument();
});
